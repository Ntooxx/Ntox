# Programming — Debugging & Troubleshooting (Deep Dive)

## Purpose

The art of finding and fixing bugs. Not just fixing — understanding. Every bug is a lesson. Every crash is a clue. This skill provides the actual procedures, decision trees, and real examples that turn debugging from guessing into a systematic practice.

## Core Principle

> Debugging is twice as hard as writing the code in the first place.
> Therefore, if you write the code as cleverly as possible,
> you are, by definition, not smart enough to debug it.
> — Brian Kernighan
>
> Debugging is not about being smart.
> It's about being systematic.
> Smart people guess.
> Systematic people find.

---

## The Master Debugging Procedure

### Phase 1: Don't Panic

Before you touch anything, do this:

1. **Breathe.** Seriously. Frustration makes you blind.
2. **Read the error message.** Actually read it. All of it.
3. **Write down exactly what happened.** Not what you think happened. What actually happened.
4. **Write down what you expected.** The gap between expected and actual is where the bug lives.

**Real Example:**
```
What happened: App crashes with "TypeError: Cannot read properties of undefined (reading 'map')"
What I expected: The list should render with items
The gap: Something is undefined when I expected an array
```

### Phase 2: Reproduce

**The Golden Rule:** If you can't reproduce it, you can't fix it.

**Reproduction Checklist:**
```
□ What are the exact steps?
□ What is the input data?
□ What is the environment (OS, browser, version)?
□ Does it happen every time, or intermittently?
□ Does it happen on fresh data, or specific data?
□ Does it happen for all users, or specific users?
□ Can you reproduce it in development?
□ Can you reproduce it in a minimal example?
```

**Real Example:**
```
Steps to reproduce:
1. Open the app
2. Click "Dashboard"
3. Click "Add New Item"
4. Leave the name field empty
5. Click "Save"
6. App crashes

Environment: Chrome 120, Windows 11, Node 18
Frequency: Every time
Scope: All users
```

**If you CAN'T reproduce:**
- Check logs for patterns
- Ask the reporter for more details
- Try different environments
- Check for timing issues (race conditions)
- Check for data-specific issues

### Phase 3: Isolate

**The Binary Search Method:**

```
Full application
    ↓
Is the bug in the UI or the backend?
    ↓
Is the bug in the API call or the response processing?
    ↓
Is the bug in the specific function or its dependencies?
    ↓
Is the bug in the logic or the data?
    ↓
Found the location
```

**Real Example:**
```
Bug: Users can't log in

Step 1: UI or backend?
- Check browser network tab
- See: POST /api/auth/login returns 500
- Conclusion: Backend bug

Step 2: API call or response?
- Check the request body
- See: { "email": "user@example.com", "password": "..." }
- Request looks fine. Server returns 500.
- Conclusion: Server-side bug

Step 3: Which part of the server?
- Check server logs
- See: "Cannot read property 'hash' of undefined"
- Stack trace points to: auth.service.js line 42
- Conclusion: auth.service.js has the bug

Step 4: Logic or data?
- Read line 42: `const hashedPassword = user.password.hash;`
- Add logging: `console.log('user:', user);`
- Result: `user` is undefined
- Conclusion: The user lookup is failing

Step 5: Why is user undefined?
- Check the query: `findByEmail(email)`
- The email is correct
- Check the database
- The user exists with a different email format (uppercase)
- Conclusion: Case-sensitive email comparison
```

### Phase 4: Hypothesize

**Decision Tree for Hypothesis Generation:**

```
What type of bug is this?

├── TypeError / ReferenceError
│   ├── Variable not defined → Check scope, imports, typos
│   ├── Property of undefined → Check data flow, null checks
│   └── Function not defined → Check imports, spelling
│
├── Logic Error (wrong output)
│   ├── Off-by-one → Check loop bounds
│   ├── Wrong condition → Check boolean logic
│   ├── Wrong calculation → Check math
│   └── Wrong order → Check sequence of operations
│
├── Data Error
│   ├── Wrong data format → Check parsing, serialization
│   ├── Missing data → Check data flow, defaults
│   ├── Corrupt data → Check data source, mutations
│   └── Wrong data type → Check type conversions
│
├── Timing/Concurrency
│   ├── Race condition → Check shared state, synchronization
│   ├── Deadlock → Check lock ordering
│   ├── Timeout → Check network, slow operations
│   └── Stale data → Check caching, state management
│
├── Memory
│   ├── Memory leak → Check event listeners, subscriptions, closures
│   ├── Stack overflow → Check recursion depth
│   └── Out of memory → Check data sizes, allocations
│
└── Network/External
    ├── Connection refused → Check server status, URL
    ├── Timeout → Check network, server load
    ├── DNS failure → Check domain, DNS config
    └── Certificate error → Check TLS, certificates
```

### Phase 5: Test the Hypothesis

**The Scientific Method for Debugging:**

```
1. State hypothesis: "The bug is caused by X"
2. Design test: "If I do Y, I should see Z"
3. Run test: Actually do Y
4. Observe: What did you see?
5. Conclude: Was your hypothesis correct?
```

**Real Example:**
```
Hypothesis: "The email comparison is case-sensitive"
Test: "If I log in with the exact email in the database, it should work"
Result: Login successful
Conclusion: Hypothesis confirmed — case sensitivity is the issue
```

**If hypothesis is WRONG:**
```
1. What did I expect to happen?
2. What actually happened?
3. What does this tell me?
4. What's my new hypothesis?
5. Back to step 2
```

### Phase 6: Fix

**The Fix Checklist:**
```
□ Fix the root cause, not the symptom
□ Does the fix actually solve the problem?
□ Does the fix introduce new problems?
□ Is the fix minimal (doesn't change unrelated code)?
□ Is the fix safe (doesn't break edge cases)?
□ Does the fix work in all environments?
```

**Real Example:**
```
Bug: Case-sensitive email comparison

Fix option 1 (wrong): `if (user.email === email.toLowerCase())`
  Problem: What if the stored email is uppercase?

Fix option 2 (better): `if (user.email.toLowerCase() === email.toLowerCase())`
  Problem: What if email is null?

Fix option 3 (correct):
  const normalizedEmail = (email || '').toLowerCase().trim();
  const user = await findByEmail(normalizedEmail);
  if (!user) return null;
  // ... rest of auth logic
```

### Phase 7: Verify and Prevent

**Verification Checklist:**
```
□ Bug no longer occurs with original reproduction steps
□ Edge cases are handled
□ No regressions in existing functionality
□ Tests cover the bug scenario
□ Documentation is updated if needed
```

**Prevention Checklist:**
```
□ Add a regression test
□ Check for similar bugs elsewhere
□ Update error handling
□ Add logging/alerting if needed
□ Document what was learned
```

---

## Debugging Decision Trees

### Decision Tree 1: "It doesn't work"

```
"It doesn't work"
│
├── Does it compile/run?
│   ├── NO → Compilation/runtime error
│   │   ├── Read the error message
│   │   ├── Fix the syntax/type error
│   │   └── Check imports and dependencies
│   │
│   └── YES → Logic error
│       ├── Is there an error in the console/logs?
│       │   ├── YES → Read the stack trace
│       │   │   ├── Where did the error originate?
│       │   │   └── What was the state when it failed?
│       │   │
│       │   └── NO → Silent failure
│       │       ├── Is there a network request?
│       │       │   ├── Check network tab
│       │       │   ├── Check request/response
│       │       │   └── Check for CORS, auth, errors
│       │       │
│       │       └── Is there a state issue?
│       │           ├── Add console.log at key points
│       │           ├── Check state transitions
│       │           └── Check for stale state
```

### Decision Tree 2: "It was working before"

```
"It was working before"
│
├── What changed?
│   ├── Code change?
│   │   ├── Find the commit that broke it (git bisect)
│   │   ├── Review the change
│   │   └── Revert or fix
│   │
│   ├── Data change?
│   │   ├── What data changed?
│   │   ├── Does the code handle this data?
│   │   └── Add validation/handling
│   │
│   ├── Environment change?
│   │   ├── New OS/browser version?
│   │   ├── New dependency version?
│   │   ├── New configuration?
│   │   └── Update code to handle new environment
│   │
│   └── Infrastructure change?
│       ├── Server changes?
│       ├── Network changes?
│       ├── Database changes?
│       └── Check infrastructure logs
```

### Decision Tree 3: "It works on my machine"

```
"It works on my machine"
│
├── What's different between environments?
│   ├── OS/Platform
│   │   ├── Path separators (/ vs \)
│   │   ├── Case sensitivity (file names)
│   │   ├── Line endings (\n vs \r\n)
│   │   └── Environment variables
│   │
│   ├── Dependencies
│   │   ├── Different versions?
│   │   ├── Missing dependencies?
│   │   └── Check package-lock.json, requirements.txt
│   │
│   ├── Configuration
│   │   ├── Environment variables set?
│   │   ├── Config files present?
│   │   └── Check .env, config files
│   │
│   ├── Data
│   │   ├── Different data on different machines?
│   │   ├── Database state different?
│   │   └── Check data migration, seeding
│   │
│   └── Network
│       ├── Different network conditions?
│       ├── Different API endpoints?
│       ├── Firewall/proxy differences?
│       └── Check network configuration
```

### Decision Tree 4: "It's slow"

```
"It's slow"
│
├── What is slow?
│   ├── Page load
│   │   ├── Check network tab (TTFB, transfer size)
│   │   ├── Check bundle size
│   │   ├── Check render performance
│   │   └── Check for render-blocking resources
│   │
│   ├── API response
│   │   ├── Check server logs
│   │   ├── Check database queries
│   │   ├── Check external service calls
│   │   └── Check caching
│   │
│   ├── UI interaction
│   │   ├── Check for expensive re-renders
│   │   ├── Check for memory leaks
│   │   ├── Check for synchronous operations
│   │   └── Use browser profiler
│   │
│   └── Background process
│       ├── Check CPU usage
│       ├── Check memory usage
│       ├── Check I/O usage
│       └── Check for infinite loops
```

---

## Real Debugging Examples

### Example 1: The Silent Failure

**Scenario:** User reports "the form doesn't submit"

**What I see:**
- Form appears correctly
- User fills in fields
- Clicks "Submit"
- Nothing happens. No error. No redirect.

**My investigation:**
```
Step 1: Check browser console
Result: Empty. No errors.

Step 2: Check network tab
Result: No network request is made when clicking Submit.

Step 3: Check the click handler
Code:
  document.getElementById('submit-btn').addEventListener('click', handleSubmit);

Step 4: Check if the element exists
Result: The element has id="submit_button" (underscore, not hyphen)

Step 5: Check for console.log
Result: If I add console.log('clicked'), it never fires

Step 6: Check JavaScript errors in the page
Result: Earlier script has a syntax error, preventing later scripts from loading

Step 7: Fix the earlier syntax error

Step 8: Now the click handler works

Root cause: A syntax error in an earlier script prevented the form handler from being registered.
```

**Lesson:** Always check for errors EARLIER in the page. Silent failures often mean the code never ran.

### Example 2: The Race Condition

**Scenario:** "Sometimes the data is wrong after loading"

**What I see:**
- User loads the page
- Data displays correctly 90% of the time
- 10% of the time, data is incomplete or wrong

**My investigation:**
```
Step 1: Can I reproduce it?
Result: Yes, but only sometimes. Hard to reproduce consistently.

Step 2: Check the data flow
Code:
  useEffect(() => {
    fetchUserData(userId).then(data => setUser(data));
    fetchUserPosts(userId).then(posts => setPosts(posts));
  }, [userId]);

Step 3: Think about timing
- Two fetches happen simultaneously
- They can complete in any order
- If fetchUserPosts completes before fetchUserData
  and the state updates are batched weirdly...
  
Step 4: Check the rendering logic
Code:
  if (user && posts) {
    return <Dashboard user={user} posts={posts} />;
  }

Step 5: Add logging
Result: Sometimes posts arrive before user data

Step 6: The real issue
- The component re-renders when either state updates
- But the conditional rendering doesn't check consistency
- What if posts arrive first, user is null, component returns null
- Then user arrives, component renders with user but stale posts

Step 7: Fix
  useEffect(() => {
    const loadData = async () => {
      const [userData, postsData] = await Promise.all([
        fetchUserData(userId),
        fetchUserPosts(userId)
      ]);
      setUser(userData);
      setPosts(postsData);
    };
    loadData();
  }, [userId]);
```

**Lesson:** Race conditions are timing-dependent. Use `Promise.all` or similar to ensure consistency.

### Example 3: The Memory Leak

**Scenario:** "The app gets slower the longer I use it"

**What I see:**
- App starts fast
- After 30 minutes, it's noticeably slower
- After 2 hours, it's barely usable

**My investigation:**
```
Step 1: Check memory usage in dev tools
Result: Memory keeps growing. Never goes down.

Step 2: Take heap snapshots
- Snapshot 1: 50MB
- Snapshot 2: 80MB (after 5 min)
- Snapshot 3: 120MB (after 10 min)

Step 3: Compare snapshots
Result: Growing number of event listeners

Step 4: Find the source
Code:
  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

Step 5: Check handleResize
Code:
  const handleResize = () => {
    setWidth(window.innerWidth);
  };

Step 6: Check component lifecycle
Result: The component is unmounting and remounting
(due to parent re-renders with different keys)

Step 7: Each remount adds a new listener
But the cleanup only removes the LAST listener

Step 8: Fix
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
```

**Lesson:** Always clean up subscriptions and listeners. Use stable references.

### Example 4: The Data Bug

**Scenario:** "The total is wrong"

**What I see:**
- User has items with prices
- Total should be $100.00
- Total shows $99.99

**My investigation:**
```
Step 1: Check the data
Items: $33.33, $33.33, $33.33
Expected total: $99.99

Step 2: Check the code
Code:
  const total = items.reduce((sum, item) => sum + item.price, 0);

Step 3: Check the result
Result: 99.99000000000001

Step 4: Why?
Floating point arithmetic:
  33.33 + 33.33 = 66.66
  66.66 + 33.33 = 99.99000000000001

Step 5: This is a known issue
JavaScript (and all IEEE 754 implementations) can't represent all decimals exactly.

Step 6: Fix options
Option A: Round to 2 decimal places
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const roundedTotal = Math.round(total * 100) / 100;

Option B: Use integers (cents)
  Store prices as cents: 3333, 3333, 3333
  Total: 9999 cents = $99.99

Option C: Use a decimal library
  import Decimal from 'decimal.js';
  const total = items.reduce((sum, item) => sum.plus(new Decimal(item.price)), new Decimal(0));

Step 7: Choose based on context
- For display: Option A (round for display)
- For storage: Option B (store as cents)
- For precision-critical: Option C (use decimal library)
```

**Lesson:** Floating point is not exact. Know when precision matters.

### Example 5: The Security Bug

**Scenario:** "Users can see each other's data"

**What I see:**
- User A logs in
- User A can see User B's private data
- This is a security vulnerability

**My investigation:**
```
Step 1: Understand the data flow
User A requests: GET /api/users/B/data
Server returns: User B's data

Step 2: Check the API endpoint
Code:
  app.get('/api/users/:id/data', async (req, res) => {
    const userData = await db.query(
      'SELECT * FROM user_data WHERE user_id = ?',
      [req.params.id]
    );
    res.json(userData);
  });

Step 3: The problem
The endpoint uses req.params.id (URL parameter)
NOT the authenticated user's ID

Step 4: Fix
Code:
  app.get('/api/users/:id/data', authenticate, async (req, res) => {
    // Check if the authenticated user is requesting their own data
    if (req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const userData = await db.query(
      'SELECT * FROM user_data WHERE user_id = ?',
      [req.params.id]
    );
    res.json(userData);
  });

Step 5: Better fix (defense in depth)
  app.get('/api/users/:id/data', authenticate, async (req, res) => {
    if (req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // Also filter by user_id in the query (defense in depth)
    const userData = await db.query(
      'SELECT * FROM user_data WHERE user_id = ?',
      [req.user.id]  // Use authenticated user ID, not URL parameter
    );
    res.json(userData);
  });

Step 6: Audit similar endpoints
Check ALL other endpoints for the same pattern.
```

**Lesson:** Never trust client-provided identifiers. Always verify authorization.

---

## Debugging Tools and When to Use Them

| Tool | When to Use | What It Shows |
|------|-------------|---------------|
| **console.log** | Quick investigation | Variable values at specific points |
| **Debugger/Breakpoints** | Complex logic | Full state at any point |
| **Network Tab** | API issues | Request/response details |
| **Profiler** | Performance issues | Time spent in functions |
| **Memory Profiler** | Memory leaks | Memory allocation over time |
| **Linter** | Syntax/type errors | Code issues before runtime |
| **Git Bisect** | Regression bugs | Which commit introduced the bug |
| **Logs** | Production issues | What happened over time |
| **Error Tracking** | Production errors | Aggregated error data |

---

## The Anti-Debugging Checklist

**DON'T:**

```
□ Change random things hoping it fixes the issue
□ Add code without understanding why
□ Ignore the error message
□ Skip reproduction
□ Assume you know what the problem is
□ Fix the symptom instead of the root cause
□ Skip testing the fix
□ Commit without verifying
□ Forget to add regression tests
□ Debug while angry/frustrated
```

**DO:**

```
□ Read the error message carefully
□ Reproduce the bug reliably
□ Understand the code before changing it
□ Make one change at a time
□ Test after each change
□ Fix the root cause
□ Verify the fix works
□ Add a regression test
□ Commit with a clear message
□ Take breaks when stuck
```

---

## When to Stop and Ask for Help

You've been debugging for:
- 30 minutes without progress → take a break
- 1 hour without progress → ask a colleague
- 2 hours without progress → step away completely
- Half a day → you're in the wrong headspace

**Signs you need help:**
- You keep going in circles
- You're making random changes
- You're angry at the code
- You can't explain what you've tried
- You're tired

**How to ask for help effectively:**
```
1. What are you trying to do?
2. What did you expect to happen?
3. What actually happened?
4. What have you already tried?
5. Can you reproduce it reliably?
6. What's the minimal code that reproduces it?
```

---

## Cross-References

- **Testing & QA**: Tests prevent and catch bugs. See `Core/06_Testing_QA.md`
- **Code Review**: Review catches bugs early. See `Engineering/12_Code_Review.md`
- **Refactoring**: Refactoring makes code easier to debug. See `Engineering/11_Refactoring.md`
- **Performance**: Performance debugging is different. See `Engineering/09_Performance_Optimization.md`
- **Logging**: Good logging enables debugging. See `Engineering/07_DevOps_Deployment.md`
- **Debugging Mindset**: Meta-cognition helps debugging. See NTOX `Core/02_Meta_Cognition.md`
- **Scientific Method**: Debugging IS the scientific method. See NTOX `Core/04_Scientific_Method.md`
- **Critical Thinking**: Critical thinking finds bugs. See NTOX `Core/05_Critical_Thinking.md`

---

## The Debugging Mantra

> Don't panic.
> Reproduce first.
> Isolate the problem.
> Hypothesize before changing.
> Test your hypothesis.
> Fix the root cause.
> Verify the fix.
> Add a regression test.
> Learn from the bug.
> And when you're stuck,
> walk away.
> The bug will be there tomorrow.
> But your sanity might not be.
