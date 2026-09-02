# LinkedIn Profile Evaluation

## Triggers
- "evaluate my profile"
- "linkedin review"
- "profile score"
- "optimize linkedin"
- "profile feedback"
- "rate my profile"
- "profile audit"

## Purpose
Evaluates a LinkedIn or professional profile and provides actionable improvement recommendations. Uses the profile_eval tool to analyze the page text, then synthesizes feedback into a prioritized action plan.

## Core Principle

A LinkedIn profile is a landing page. Every section either converts a visitor into a connection, a message, or an interview — or it doesn't. Score honestly: most profiles are 40-60/100.

## Workflow

1. If the user provides a LinkedIn URL, use the browse tool with action=snapshot and scrollTimes=5 to capture the full profile page
2. Pass the content to the profile_eval tool with the user's target role as roleContext
3. Present the results as a clear scorecard
4. List the top 3 quick wins (changes that take < 10 minutes each)
5. List the top 3 structural improvements (bigger changes with higher impact)
6. Offer to save the evaluation so the user can track changes over time

## Evaluation Criteria

- Headline: Clear role, value proposition, keywords for search
- Summary: Compelling story, achievements, call to action
- Experience: Quantified accomplishments, progression, keywords
- Skills: Relevant skills, endorsements, prioritization
- Recommendations: Specific, from relevant people, recent
- Activity: Posts, articles, comments, engagement

## Output Format

Show scores on a 1-10 scale with specific feedback for each section. Then:

QUICK WINS (do today):
1. [specific change — exactly what to write or change]
2. [specific change]
3. [specific change]

STRUCTURAL IMPROVEMENTS (this week):
1. [bigger change with estimated impact]
2. [bigger change with estimated impact]

## Platform Notes

LinkedIn is the primary focus, but this skill works for any professional profile (GitHub, personal website, AngelList). The profile_eval tool is format-agnostic.
