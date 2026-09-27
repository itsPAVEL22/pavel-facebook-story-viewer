# Pavel × Sohag × Boisakhi — Story Viewer V2

Vercel-ready Express app for viewing publicly accessible Facebook Stories.

## Local
```bash
npm install
npm start
```
Open http://localhost:3000

## Vercel
1. Push this folder to a GitHub repository.
2. Import the repository in Vercel.
3. In Vercel: Project → Settings → Environment Variables.
4. Add `APIFY_TOKEN` with your Apify token.
5. Add `PROFILE_ACTOR` = `premiumscraper~facebook-pages-profile-scraper` if you want to override the default.
6. Add `STORY_ACTOR` = `codenest~facebook-story-downloader` if you want to override the default.
7. Redeploy after saving environment variables.

The API token is server-side only. Do not commit `.env`.

This project is intended for publicly accessible Stories only. It does not bypass login, private/Friends-only access, CAPTCHA, or other access controls.
