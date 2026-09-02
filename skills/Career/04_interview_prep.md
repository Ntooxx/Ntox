# Interview Preparation

## Triggers
- "interview prep"
- "prepare for interview"
- "practice interview"
- "technical interview"
- "behavioral interview"
- "study for interview"
- "mock interview"
- "interview questions"

## Purpose
Generates targeted interview preparation plans based on the specific role and company. Uses search and browse tools for company research, then creates study plans with technical topics, behavioral questions, and company-specific preparation.

## Workflow

1. Identify the target job:
   - If the user specifies a company/role, use that
   - Otherwise, check job_tracker for applications in "interviewing" status
   - If no tracker entry, ask the user for the job details

2. Research the company:
   a. Search for "{company} tech stack" and "{company} engineering blog"
   b. Browse the company's careers page for culture signals
   c. Search for "{company} interview questions {role}"
   d. Search for recent news about the company

3. Analyze the job requirements:
   a. If the job is in the tracker, extract requirements from the listing
   b. If not, ask the user for the job description
   c. Identify technical skills, tools, and domains mentioned

4. Cross-reference with user's profile:
   a. Check user's expertise domains against job requirements
   b. Identify gaps (skills the user hasn't demonstrated)
   c. Identify strengths (areas where the user is expert level)

5. Generate a prep plan:
   a. Technical topics to review (prioritize by gap vs strength)
   b. Common behavioral questions for the role level
   c. Company-specific questions (based on research)
   d. System design topics (for senior roles)
   e. Questions to ask the interviewer

6. If the interview is > 3 days away, create a day-by-day study schedule

## Study Plan Format

```
INTERVIEW PREP: [role] at [company]
══════════════════════════════════
Date: [interview date or "TBD"]
Days remaining: [X]

COMPANY PROFILE:
- Tech stack: [list from research]
- Recent news: [1-2 relevant items]
- Culture signals: [what the research suggests]

YOUR FIT:
Strengths: [areas where you exceed requirements]
Gaps: [areas to prepare for]

TECHNICAL TOPICS TO REVIEW:
1. [topic] — Why: [connection to job requirements]
2. [topic] — Why: [connection to job requirements]
3. [topic] — Why: [connection to job requirements]

SYSTEM DESIGN (senior roles):
- [relevant design question the interviewer might ask]
- [relevant design question]

BEHAVIORAL QUESTIONS TO PREPARE:
1. "Tell me about a time when you..." [specific to this role]
2. "Describe a situation where you had to..." [specific to this role]
3. "How do you handle..." [specific to this role]

QUESTIONS TO ASK THEM:
1. [insightful question about their tech stack]
2. [question showing you researched them]
3. [question about team/role specifics]

STUDY SCHEDULE:
Day 1: [topics] + company research review
Day 2: [topics] + behavioral prep
Day 3: [topics] + mock interview + final review
```

## Practice Mode

If the user asks for practice:
- Ask behavioral questions one at a time
- Provide brief feedback after each answer
- Focus on STAR format (Situation, Task, Action, Result)
- Point out when answers are too vague or lack specifics
- For technical questions: ask the user to explain concepts out loud, evaluate clarity

## Sources for Questions

- Company Glassdoor/Indeed interview reviews
- Company engineering blog (reveals what they value)
- Job description (reveals required competencies)
- Level-specific expectations (junior vs senior questions differ)
