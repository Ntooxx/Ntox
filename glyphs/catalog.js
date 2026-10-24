(() => {
  const items = [
    ["intro", "Intro", "Threshold", "An eclipse rising above a field of light.", "Experience", '<path d="M4 15a8 8 0 1 1 16 0M2 17h20M5 20h14"/>'],
    ["overview", "Overview", "World", "A luminous world held in an orbital frame.", "Workspace", '<circle cx="12" cy="12" r="7"/><ellipse cx="12" cy="12" rx="10" ry="3" transform="rotate(-25 12 12)"/>'],
    ["agents", "Agents", "Constellation", "Three distinct bodies sharing one orbital system.", "Workspace", '<circle cx="12" cy="12" r="3"/><path d="M12 5V3M6 16l-2 2M18 16l2 2"/><circle cx="12" cy="3" r="1.5"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="18" r="1.5"/>'],
    ["chat", "Chat", "Exchange", "Two open brackets exchanging a thread of light.", "Workspace", '<path d="M8 4H4v16h4M16 4h4v16h-4M8 12h8"/><circle cx="12" cy="12" r="2"/>'],
    ["tasks", "Tasks", "Sequence", "A stepped path with four deliberate checkpoints.", "Workspace", '<path d="M4 18h5v-6h6V6h5"/><circle cx="4" cy="18" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="20" cy="6" r="1.5"/>'],
    ["workflows", "Workflows", "Branch", "One signal splits, travels, and rejoins.", "Workspace", '<path d="M5 12h4l3-6h6M9 12l3 6h6"/><circle cx="4" cy="12" r="2"/><rect x="18" y="4" width="4" height="4" rx="1"/><rect x="18" y="16" width="4" height="4" rx="1"/>'],
    ["memory", "Memory / Knowledge", "Strata", "Four transparent planes storing a shared history.", "Workspace", '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>'],
    ["tools", "Tools", "Aperture", "Six precision blades around an open center.", "Workspace", '<circle cx="12" cy="12" r="9"/><path d="m12 3 5 9-5 9-5-9 5-9ZM4.2 7.5h10.4M9.4 16.5h10.4"/>'],
    ["evaluations", "Evaluations", "Calibrate", "A diamond measured against an exacting frame.", "Workspace", '<path d="m12 4 8 8-8 8-8-8 8-8ZM2 8V2h6M16 2h6v6M22 16v6h-6M8 22H2v-6M8 12h8"/>'],
    ["settings", "Settings", "Alignment", "Offset rings and indexed controls finding balance.", "Workspace", '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 1v5M18 12h5M12 18v5M1 12h5"/>'],
    ["onboarding", "Onboarding", "Discovery", "Successive portals reveal a bright destination.", "Experience", '<path d="M4 20V4h12M8 20V8h12M12 20V12h8M15 16h6m-3-3 3 3-3 3"/>'],
    ["create-agent", "Create agent", "Genesis", "Loose particles converge into a new orbital core.", "Experience", '<path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="3"/><path d="m5 5 2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>'],
    ["agent-detail", "Agent detail", "Identity", "A singular world with a precise meridian signature.", "Experience", '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3" ry="8"/><path d="M4 12h16M6 7h12M6 17h12"/>'],
    ["running", "Running / Live view", "Vortex", "A spiral carries energy toward its central source.", "Experience", '<path d="M12 12c-3-4 4-6 6-2s-2 10-7 9S2 13 4 8 14 1 19 6"/><circle cx="12" cy="12" r="1.5"/>'],
    ["analytics", "Analytics", "Signal", "Two measured waves meet at luminous samples.", "Workspace", '<path d="M3 3v18h18M5 16l5-7 4 4 6-9"/><circle cx="10" cy="9" r="1.5"/><circle cx="14" cy="13" r="1.5"/>'],
    ["integrations", "Integrations", "Nexus", "An open hub with six connected endpoints.", "Workspace", '<circle cx="12" cy="12" r="3"/><path d="M12 9V3M15 12h6M12 15v6M9 12H3"/><circle cx="12" cy="3" r="1.5"/><circle cx="21" cy="12" r="1.5"/><circle cx="12" cy="21" r="1.5"/><circle cx="3" cy="12" r="1.5"/>'],
    ["multi-agent", "Multi-agent view", "Collective", "Independent worlds connected across a shared plane.", "Experience", '<circle cx="5" cy="15" r="3"/><circle cx="13" cy="6" r="3"/><circle cx="20" cy="16" r="3"/><path d="m7 12 4-4m4 0 4 5M8 16h9"/>'],
    ["research", "Research agent", "Lens", "A scanning lens encircles a densely sampled world.", "Agent identities", '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/><path d="m15 15 6 6M10 2v3M2 10h3"/>'],
    ["content", "Content agent", "Composition", "Parallel strokes collect into a structured volume.", "Agent identities", '<path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h5"/>'],
    ["outreach", "Outreach agent", "Broadcast", "A central signal sends three expanding wavefronts.", "Agent identities", '<circle cx="6" cy="12" r="2"/><path d="M10 7a7 7 0 0 1 0 10M14 4a11 11 0 0 1 0 16M18 2a14 14 0 0 1 0 20"/>'],
    ["analysis", "Analysis agent", "Prism", "A faceted prism separates one line into multiple readings.", "Agent identities", '<path d="m12 3 9 17H3L12 3ZM1 11h7M16 10h7M17 14h6M18 18h5"/>'],
  ];
  globalThis.NTOXGlyphs = {
    items: items.map(([id, label, name, description, group, icon], index) => ({ id, label, name, description, group, icon, number: String(index + 1).padStart(2, "0") })),
  };
})();
