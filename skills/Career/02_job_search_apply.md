# Job Search and Application

## Triggers
- "search for jobs"
- "find jobs"
- "job search"
- "look for openings"
- "apply to jobs"
- "find positions"
- "job hunt"
- "what jobs match me"

## Purpose
Searches multiple job boards for matching positions, evaluates fit against the user's profile, and tracks applications in the job_tracker. Uses browse for JS-rendered job boards and search for Google Jobs results.

## Platforms
- LinkedIn: browse linkedin.com/jobs/search + individual listings
- Indeed: browse indeed.com/jobs
- Glassdoor: browse glassdoor.com/Job/
- Google Jobs: search tool with "site:linkedin.com/jobs {keywords}" and similar patterns
- Wellfound: browse wellfound.com/jobs

## Workflow

1. Ask the user what they're looking for:
   - Keywords / job titles
   - Location preference
   - Remote preference
   - Salary range (if known)
   - Seniority level

2. Build a JobSearchQuery from their answers and their user profile (domains, expertise, goals)

3. Search each platform:
   a. For LinkedIn/Indeed/Glassdoor/Wellfound: browse the search results page with snapshot action
   b. For Google Jobs: use the search tool
   c. For promising listings: browse the individual listing page with extract action on the job description

4. For each listing found:
   a. Evaluate match score (0-100) based on:
      - Title alignment with target roles (30 points)
      - Skills overlap with user expertise (30 points)
      - Location/remote fit (15 points)
      - Salary alignment (15 points)
      - Company signals — size, tech stack, reputation (10 points)
   b. Store in job_tracker with status="discovered" and matchScore
   c. Only show results above 60 match score unless user asks for "everything"

5. Present the top matches sorted by score, with a one-line reason why each matches

6. For top matches (80+ score), offer to help apply or save for later

## Duplicate Prevention

Before adding a listing to the tracker, search job_tracker by company + title. If a match exists with the same company and similar title within 30 days, skip it.

## Output Format

```
Found [N] new jobs across [M] platforms:

TOP MATCHES:
1. [title] at [company] — Score: [X]/100
   Platform: [source] | Location: [location] | Salary: [range]
   Why: [1-line reason this matches your profile]
   URL: [url]

2. ...

Already tracking [Y] applications total. [Z] need follow-up.
```

## Efficiency Notes

- Don't browse every listing — start with the search results page to get titles + companies
- Only browse individual listings for the top candidates (the LLM can estimate match from search results)
- Use the search tool for supplementary Google Jobs results
- Batch tool calls: browse search results, analyze, then browse selected listings
