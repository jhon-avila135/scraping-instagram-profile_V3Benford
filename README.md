Instagram Profile Analyzer (V3Benford)

Academic project that reads a public Instagram profile with a real browser (Playwright) and shows the results in a local Flask dashboard. It answers three questions:

What is on the profile? Counters, biography, posts, likes and comments.
What personality do the posts suggest? An exploratory Big Five estimate by the Gemini API, with reasoning, evidence and a written conclusion.
Does the audience look organic? A Benford's law test on the follower counts of at least 200 accounts, used as a screening signal for bots or bought followers.
Quick start

Requires Python 3.9 or newer.

bash
git clone https://github.com/jhon-avila135/scraping-instagram-profile_V3Benford.git
cd scraping-instagram-profile_V3Benford

python -m venv venv
# Windows (PowerShell): venv\Scripts\Activate.ps1
# macOS / Linux:        source venv/bin/activate

pip install -r requirements.txt
playwright install chromium
cp .env.example .env        # then add GEMINI_API_KEY

python app.py

Open http://127.0.0.1:5000 and work top to bottom:

Scrape a username (posts to collect, posts to read in detail).
Analyze with Gemini after confirming the owner agreed.
Run Benford check, which visits about 200 accounts and takes 10 to 15 minutes.
Configuration
Variable	Purpose
GEMINI_API_KEY	Key from Google AI Studio
GEMINI_MODEL	Optional model override (default gemini-flash-latest); list options with python analyzer.py --list-models
INSTAGRAM_SESSIONID	Optional session cookie; leave empty to log in by hand

Instagram login. Use a secondary test account. On the first run Chromium opens on the login page; sign in once and the session is kept in browser_profile/.

How it works
Stage	Module	What happens
Scraping	scraper.py	Persistent browser session, polling waits, infinite scroll, counters from og:description
Personality	analyzer.py	Anonymized data goes to Gemini, which returns structured trait scores; 3 runs are averaged
Authenticity	benford.py	First-digit distribution of follower counts compared with Benford's curve
Interface	app.py, templates/, static/	Background jobs, status polling, radar and Benford charts
Big Five estimate
Each trait has a score from 1 to 5, a confidence level, cited posts and a rationale, plus a conclusion with headline, narrative and caveat.
Three runs at low temperature are averaged; the spread becomes a consistency label.
The owner can answer the BFI-10 questionnaire and compare it against the estimate.
Benford check

Follower counts of natural audiences tend to start with 1 about 30% of the time and with 9 under 5% of the time (expected share of digit d: log10(1 + 1/d)). Batches of fake accounts often break that pattern.

Verdict by chi-square p-value: above 0.05 consistent, 0.01 to 0.05 inconclusive, below 0.01 deviates.
MAD is reported next to its chance level (about 0.235 / sqrt(n)). Nigrini's fixed limits need thousands of values, so they are not used with 200.
Magnitude span under 2 orders downgrades a deviation to inconclusive.
Zero counts have no first digit; they are excluded from the test and reported separately.
Switching the sampled list

The check samples followers by default. To sample the accounts the profile follows, change one line near the top of scraper.py and restart:

python
AUDIENCE_LIST = "followers"   # or "following"
Project structure
app.py            Flask server, background jobs and API routes
scraper.py        Playwright scraping and audience sampling
analyzer.py       Gemini prompt, validation and BFI-10 comparison
benford.py        Benford statistics and CLI
templates/        Dashboard page
static/           styles.css, charts.js, app.js
data/             Generated JSON (git-ignored)
Privacy and responsible use
Commenters become owner or user_N, and @mentions become @user; the mapping is never saved.
Username, URLs and display name are removed before anything is sent to Gemini.
The Benford check stores only integers; usernames are discarded after each visit.
data/*.json, .env and browser_profile/ are git-ignored. The session cookie and API keys are equivalent to passwords.
Analyze only profiles whose owner agreed. Both the Big Five estimate and the Benford result are exploratory signals, not diagnoses or proof.
Troubleshooting
Symptom	What to do
Instagram asks for a login	Run with the window visible and sign in once
Gemini returns 503 or stalls	The service is overloaded; try again after a moment or switch GEMINI_MODEL
The audience list does not open	Run with the window visible and dismiss any overlay; this does not mean the profile is private
Rate limit or login mid-check	Wait a few hours; visiting 200 accounts is heavy traffic
Fewer than 200 usable accounts	Use a profile with more followers
References
Benford, F. (1938). The law of anomalous numbers.
Nigrini, M. (2012). Benford's Law: Applications for Forensic Accounting, Auditing, and Fraud Detection.
Rammstedt, B., & John, O. P. (2007). Measuring personality in one minute or less: a 10-item short version of the Big Five Inventory.
License

MIT. Copyright (c) Jhon Avila (@jhon-avila135).