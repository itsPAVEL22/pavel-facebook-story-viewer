import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const PROFILE_ACTOR =
  process.env.PROFILE_ACTOR || "premiumscraper~facebook-pages-profile-scraper";
const STORY_ACTOR =
  process.env.STORY_ACTOR || "codenest~facebook-story-downloader";

if (!APIFY_TOKEN) {
  console.warn("WARNING: APIFY_TOKEN is missing. Copy .env.example to .env and add your token.");
}

function assertFacebookUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Valid Facebook profile URL দিন।");
  }

  const host = url.hostname.toLowerCase();
  if (!["facebook.com", "www.facebook.com", "m.facebook.com"].includes(host)) {
    throw new Error("শুধু facebook.com profile/page URL ব্যবহার করুন।");
  }
  return url.toString();
}

async function runActorSync(actorId, input) {
  if (!APIFY_TOKEN) throw new Error("Server-এ APIFY_TOKEN সেট করা হয়নি।");

  const endpoint =
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}` +
    `/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify error ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Apify থেকে valid JSON পাওয়া যায়নি।");
  }
}

function findStoryBucket(value) {
  if (!value || typeof value !== "object") return null;

  if (value.story_bucket && typeof value.story_bucket === "object") {
    return value.story_bucket;
  }

  for (const item of Object.values(value)) {
    const found = findStoryBucket(item);
    if (found) return found;
  }
  return null;
}

function extractProfileInfo(item) {
  const raw = item?.raw_api_data ?? item;

  return {
    name:
      item?.name ??
      item?.full_name ??
      raw?.name ??
      raw?.title ??
      "Facebook profile",
    id:
      item?.id ??
      item?.userId ??
      item?.profileId ??
      raw?.id ??
      raw?.user_id ??
      null,
    profileUrl:
      item?.url ??
      item?.profileUrl ??
      raw?.url ??
      null
  };
}

function makeStoryCollectionUrl(bucket) {
  const node = bucket?.nodes?.[0];
  const id = node?.id;

  if (!id) return null;

  // The Story Downloader accepts this public Story collection shape.
  return `https://www.facebook.com/stories/${encodeURIComponent(id)}/?view_single=false`;
}

function normalizeStoryOutput(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const stories = [];

  for (const row of list) {
    if (!row || typeof row !== "object") continue;

    const rowStories = Array.isArray(row.stories) ? row.stories : [];
    for (const story of rowStories) {
      const qualities = Array.isArray(story.qualities) ? story.qualities : [];
      const usable = qualities.filter(q => q && q.url);

      if (!usable.length) continue;

      const preferred =
        usable.find(q => /original/i.test(String(q.quality))) ??
        usable.find(q => /720/i.test(String(q.quality))) ??
        usable[0];

      const format = String(preferred.format || "").toLowerCase();
      const type =
        story.type ||
        (format.includes("mp4") ? "video" : "image");

      stories.push({
        storyNo: story["Story No"] ?? story.storyNo ?? stories.length + 1,
        type,
        url: preferred.url,
        format: preferred.format || null,
        quality: preferred.quality || null,
        qualities: usable.map(q => ({
          quality: q.quality || null,
          format: q.format || null,
          url: q.url
        }))
      });
    }
  }

  return stories;
}

app.post("/api/stories", async (req, res) => {
  try {
    const profileUrl = assertFacebookUrl(String(req.body?.profileUrl || "").trim());

    // 1) Profile -> story_bucket
    const profileRows = await runActorSync(PROFILE_ACTOR, {
      facebook_urls: [{ url: profileUrl }]
    });

    if (!Array.isArray(profileRows) || profileRows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Profile পাওয়া যায়নি বা scraper কোনো data ফেরত দেয়নি।"
      });
    }

    const first = profileRows[0];
    const bucket = findStoryBucket(first);

    if (!bucket?.nodes?.length) {
      return res.status(404).json({
        ok: false,
        error: "এই public profile/page-এর জন্য active Story পাওয়া যায়নি।"
      });
    }

    const profile = extractProfileInfo(first);
    const storyUrl = makeStoryCollectionUrl(bucket);

    if (!storyUrl) {
      return res.status(404).json({
        ok: false,
        error: "Story bucket পাওয়া গেছে, কিন্তু usable Story URL তৈরি করা যায়নি।"
      });
    }

    // 2) Story collection URL -> direct CDN media URLs
    const storyRows = await runActorSync(STORY_ACTOR, {
      story_urls: [{ url: storyUrl }]
    });

    const stories = normalizeStoryOutput(storyRows);

    if (!stories.length) {
      return res.status(404).json({
        ok: false,
        error: "Story URL পাওয়া গেছে, কিন্তু media extraction হয়নি।",
        profile,
        storyUrl
      });
    }

    res.json({
      ok: true,
      profile,
      storyUrl,
      total: stories.length,
      stories
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error?.message || "Unknown server error"
    });
  }
});

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Pavel Story Viewer running at http://localhost:${PORT}`);
});
