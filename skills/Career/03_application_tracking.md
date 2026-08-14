# Application Tracking

## Triggers
- "my applications"
- "application status"
- "follow up"
- "track applications"
- "job tracker"
- "am I ghosted"
- "application dashboard"
- "where am I with jobs"
- "update application"

## Purpose
Manages the job application lifecycle. Shows status dashboard, identifies stale applications needing follow-up, and helps draft follow-up messages. Uses only the job_tracker tool.

## Workflow

### Dashboard View
When user asks for status:
1. Call job_tracker with action=stats to get summary
2. Call job_tracker with action=followups to find overdue follow-ups
3. Present dashboard with:
   - Total applications broken down by status
   - Applications this week
   - Average match score
   - Interviewing count
   - Pending follow-ups with days since application

### Status Updates
When user reports a status change ("got the interview", "received offer", "rejected", "ghosted"):
1. Identify the application by company name (search job_tracker)
2. Update the status
3. Add a note with timestamp and context
4. If rejected: ask if they want to analyze what went wrong
5. If offer: congratulate and offer to help evaluate the offer
6. If ghosted: update status and set followUpAt to null

### Follow-up Helper
When user asks about follow-ups:
1. Show all applications where status is "applied" or "responded" and the date is past the follow-up threshold
2. For each:
   - Calculate days since applied
   - Categorize: "needs gentle nudge" (5-10 days), "needs follow-up" (10-14 days), "likely ghosted" (14+ days)
3. Draft a follow-up email/message template based on:
   - Time since application
   - Company context (startup vs enterprise — startups respond faster)
   - Whether there's a known contact
   - User's communication style from their profile
4. After user reviews: update the followUpAt date

## Follow-up Timing Rules

| Days Since Applied | Status | Action |
|-------------------|--------|--------|
| 0-5 days | Patient | No action needed |
| 5-10 days | Watching | Draft gentle follow-up |
| 10-14 days | Follow up | Draft direct follow-up |
| 14+ days | Likely ghosted | Flag for review, offer to mark as ghosted |

For "responded" status (they replied but then went silent):
- 3-7 days: Watching
- 7-10 days: Draft follow-up
- 10+ days: Flag for review

## Output Format

```
APPLICATION DASHBOARD
══════════════════════
Total:     [N]
Applied:   [N] ([X] this week)
Responded: [N]
Interview: [N]
Offered:   [N]
Rejected:  [N]
Ghosted:   [N]

Avg Match Score: [X]/100

NEED FOLLOW-UP:
1. [title] at [company] — applied [X] days ago
   Suggested message: "[draft]"

2. ...

Oldest pending: [company] ([X] days)
```

## Tips

- Always search by company name for updates — users rarely remember job IDs
- Use the "notes" action for any context about interviews, recruiters, or feedback
- Regular tracking prevents the "where did I apply again?" panic
