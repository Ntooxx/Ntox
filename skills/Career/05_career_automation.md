# Career Automation (Cron-Driven)

## Triggers
- "automate job search"
- "set up job alerts"
- "schedule job check"
- "daily job scan"
- "career automation"
- "run this every morning"
- "automate my applications"

## Purpose
Sets up automated cron jobs for recurring career tasks. Creates scheduled jobs that run through the NTOX cron system and deliver results to Telegram (or other configured channels).

## Prerequisites

The cron system must be active. This requires the gateway (`ntox gateway`) to be running, which:
- Ticks the cron checker every 30 seconds
- Executes cron jobs through the agent
- Delivers results to the configured channel

## Available Automations

### 1. Daily Job Scan
Runs every morning. Searches all platforms for new matching jobs.
```
Cron schedule: "every morning at 9am"
Channel: telegram
Prompt:
  Search LinkedIn, Indeed, Glassdoor, Google Jobs, and Wellfound for [USER'S TARGET ROLES]
  in [USER'S LOCATION]. For each listing found, evaluate match against my profile.
  Add new matches above 60/100 to the job tracker. Skip duplicates.
  Send me the top 5 new finds with scores and URLs via Telegram.
```

### 2. Weekly Follow-up Check
Runs Monday morning. Identifies applications needing follow-up.
```
Cron schedule: "every monday at 10am"
Channel: telegram
Prompt:
  Check my job tracker for applications that need follow-ups.
  For each application older than 5 business days with status "applied" or "responded":
  1. Draft a follow-up message
  2. Report it to me with days since application
  Also report any applications that have been silent for 14+ days
  and suggest marking them as ghosted or withdrawn.
```

### 3. Bi-weekly Profile Evaluation
Runs on the 1st and 15th. Re-evaluates LinkedIn profile for improvements.
```
Cron schedule: "every 14 days"
Channel: telegram
Prompt:
  Evaluate my LinkedIn profile at [PROFILE URL] using profile_eval.
  Compare with the last evaluation if available.
  Report any score changes and new quick wins.
  Track the evaluation date and overall score in my notes.
```

### 4. Interview Reminder
Runs daily. Alerts about upcoming interviews.
```
Cron schedule: "daily at 8am"
Channel: telegram
Prompt:
  Check my job tracker for applications with status "interviewing".
  List all interviews and their dates.
  If any interview is in the next 3 days, offer interview prep.
  If any application in "interviewing" hasn't been updated in 5 days,
  suggest following up.
```

## Setup Instructions

When the user triggers this skill, walk through each automation:

1. Explain what each automation does
2. Check if a cron job with the same name already exists (avoid duplicates)
3. For each new job:
   - Customize the prompt with the user's actual target roles, location, and profile URL
   - Create the cron job using the cron system
   - Confirm it was added successfully
4. Remind the user that the gateway must be running (`ntox gateway`) for cron jobs to execute

## Customization

Ask the user:
- What are your target job titles? (e.g., "Senior TypeScript Developer, Staff Engineer")
- Where are you looking? (e.g., "Remote US, NYC, London")
- What's your LinkedIn profile URL?
- What salary range are you targeting?
- Any companies to prioritize or avoid?

Use these answers to customize the cron prompts.

## Telegram Delivery Format

Cron results delivered to Telegram should be concise:
```
NTOX Job Scan — July 29, 2026
══════════════════════════════
Found 3 new jobs:

1. Senior TS Engineer at Acme Corp (87/100)
   Remote — $150k-$180k
   linkedin.com/jobs/view/12345

2. Staff Developer at TechCo (82/100)
   NYC — linkedin.com/jobs/view/67890

3. Senior Frontend at StartupX (71/100)
   Remote — wellfound.com/...

Tracked: 45 total | Interviewing: 2 | Follow-ups needed: 1
```

## Notes

- Cron jobs only run while the gateway is active
- If the gateway is not running, you can start it with: `ntox gateway`
- For persistent 24/7 operation, consider running `ntox gateway` as a service
- Cron job results are delivered via the configured channel — set up your Telegram bot token in config first
