(() => {
  const TAU = Math.PI * 2;
  const random = seed => () => {
    seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
    seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
    return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
  };
  function createScene(id) {
    const scene = { lines: [], dots: [], surfaces: [], flat: false };
    const rand = random([...id].reduce((seed, char) => seed * 31 + char.charCodeAt(0) | 0, 71));
    const line = (points, alpha = .3, width = .55, flow = false) => scene.lines.push({ points, alpha, width, flow });
    const dot = (x, y, z = 0, radius = 1, alpha = .65, beacon = false) => scene.dots.push({ x, y, z, radius, alpha, beacon });
    const ring = (radius, tilt = .4, rotation = 0, center = [0, 0, 0], alpha = .3, width = .55, start = 0, end = TAU) => {
      const points = Array.from({ length: 121 }, (_, i) => {
        const angle = start + i / 120 * (end - start);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * Math.cos(tilt);
        const z = Math.sin(angle) * radius * Math.sin(tilt);
        return [x * Math.cos(rotation) - y * Math.sin(rotation) + center[0], x * Math.sin(rotation) + y * Math.cos(rotation) + center[1], z + center[2]];
      });
      line(points, alpha, width, alpha > .2);
      return points;
    };
    const sphere = (radius = 65, center = [0, 0, 0], count = 1400) => {
      scene.surfaces.push({ center, radius });
      ring(radius, 0, 0, center, .8, .8);
      ring(radius * 1.013, 0, 0, center, .18, 2);
      for (let i = 0; i < count; i++) {
        const y = 1 - 2 * (i + .5) / count;
        const theta = i * 2.399963;
        const r = Math.sqrt(1 - y * y);
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        if (z < -.12) continue;
        const brightness = .12 + .52 * Math.pow(Math.max(0, -.4 * x - .6 * y + .4 * z), 2);
        dot(center[0] + x * radius, center[1] + y * radius, center[2] + z * radius, .28 + rand() * .6, brightness);
      }
      for (let i = 0; i < 4; i++) ring(radius, 1.05 + i * .12, .2 + i * .7, center, .09, .4);
    };
    const node = (x, y, radius = 5, z = 0) => {
      ring(radius + 4, 0, 0, [x, y, z], .24);
      dot(x, y, z, radius, .95, true);
    };
    const field = (count = 150, radius = 130) => {
      for (let i = 0; i < count; i++) {
        const angle = rand() * TAU;
        const r = Math.sqrt(rand()) * radius;
        dot(Math.cos(angle) * r, Math.sin(angle) * r, (rand() - .5) * 50, .3 + rand() * .5, .04 + rand() * .17);
      }
    };
    field();
    if (id === "intro") {
      scene.flat = true;
      ring(82, 0, 0, [0, -17, 0], .95, 1, Math.PI * 1.02, Math.PI * 1.98);
      ring(82, 0, 0, [0, -17, 0], .42, .6, 0, Math.PI);
      scene.surfaces.push({ center: [0, -17, 0], radius: 81 });
      for (let j = 0; j < 24; j++) line(Array.from({ length: 90 }, (_, i) => {
        const x = -145 + i / 89 * 290;
        return [x, 64 + j * 2.4 + Math.sin(x / 48 + j * .12) * (5 + j * .18), 30];
      }), .08 + .28 * (1 - j / 24), .5, j % 4 === 0);
      node(-38, -89, 1.2);
    } else if (["overview", "agent-detail", "research"].includes(id)) {
      sphere(id === "research" ? 57 : 78);
      if (id === "agent-detail") {
        for (let j = 0; j < 5; j++) ring(78, j * .28, Math.PI / 2, [0, 0, 0], .22);
        ring(102, 1.2, -.4, [0, 0, 0], .38);
      } else {
        ring(112, 1.18, -.32, [0, 0, 0], .44);
        ring(135, 1.1, -.32, [0, 0, 0], .13);
        node(103, -32, 2.5, 30);
        if (id === "research") {
          ring(76, 0, 0, [0, 0, 0], .48);
          line([[46, 46, 0], [104, 104, 0]], .65, 1.5);
          line([[-78, 0, 60], [78, 0, 60]], .45, .7, true);
        }
      }
    } else if (id === "agents" || id === "multi-agent") {
      const bodies = id === "agents" ? [[0, -45, 32], [-76, 45, 28], [76, 45, 28]] : [[-80, 34, 28], [0, -30, 44], [87, 43, 32]];
      bodies.forEach(([x, y, r], i) => { sphere(r, [x, y, i * 8], 450); ring(r * 1.4, 1.08, -.4 + i * .45, [x, y, i * 8], .35); });
      ring(131, 1.18, -.12, [0, 0, 0], .19);
      line(bodies.map(([x, y]) => [x, y, -45]).concat([[bodies[0][0], bodies[0][1], -45]]), .15, .5, true);
    } else if (id === "chat") {
      scene.flat = true;
      line([[-52, -70, 0], [-83, -70, 0], [-83, 70, 0], [-52, 70, 0]], .85, 1.5);
      line([[52, -70, 0], [83, -70, 0], [83, 70, 0], [52, 70, 0]], .85, 1.5);
      for (let j = 0; j < 17; j++) line(Array.from({ length: 70 }, (_, i) => {
        const x = i / 69 * 140 - 70;
        return [x, Math.sin(x / 27 + j * .22) * Math.sin((x + 70) / 140 * Math.PI) * (j + 4), j];
      }), .1 + j / 90, .5, j % 5 === 0);
      node(0, 0, 3, 20);
    } else if (id === "tasks" || id === "workflows") {
      scene.flat = true;
      const points = id === "tasks" ? [[-105, 70], [-35, 70], [-35, 0], [35, 0], [35, -70], [105, -70]] : [[-105, 0], [-48, 0], [-10, -65], [85, -65]];
      line(points.map(([x, y]) => [x, y, 0]), .6, 1, true);
      if (id === "workflows") line([[-48, 0, 0], [-10, 65, 0], [85, 65, 0]], .6, 1, true);
      (id === "tasks" ? [points[0], points[2], points[4], points[5]] : [points[0], points[3], [85, 65]]).forEach(([x, y], i) => {
        node(x, y, 4);
        ring(18, 0, i, [x, y, 0], .3);
      });
      line([[-125, 105, -10], [125, 105, -10]], .1);
    } else if (id === "memory" || id === "content") {
      scene.flat = true;
      for (let layer = 0; layer < 4; layer++) {
        const y = -68 + layer * 42;
        const width = id === "content" ? 70 : 100;
        line([[0, y - 30, 0], [width, y, 0], [0, y + 30, 0], [-width, y, 0], [0, y - 30, 0]], .42 + layer * .12, .65, true);
        for (let j = 0; j < 90; j++) {
          const u = rand() * 2 - 1, v = rand() * 2 - 1;
          dot((u + v) * width / 2, y + (u - v) * 15, 0, .4, .15 + rand() * .3);
        }
        if (id === "content") for (let j = 0; j < 3; j++) line([[-38, y - 8 + j * 7, 0], [38 - j * 12, y - 8 + j * 7, 0]], .45);
      }
      line([[0, -110, 0], [0, 110, 0]], .16, .5, true);
    } else if (id === "tools") {
      ring(103, 0, 0, [0, 0, 0], .28);
      for (let j = 0; j < 6; j++) {
        const a = j / 6 * TAU;
        const points = [[88, -30], [42, -24], [15, 25]].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), 0]);
        line(points, .75, 1, true);
        node(Math.cos(a) * 104, Math.sin(a) * 104, 1.4);
      }
      ring(26, 0, 0, [0, 0, 0], .3);
    } else if (id === "evaluations" || id === "analysis") {
      const vertices = id === "analysis" ? [[0, -88, 0], [88, 75, 0], [-88, 75, 0], [0, -88, 0]] : [[0, -95, 0], [85, 0, 0], [0, 95, 0], [-85, 0, 0], [0, -95, 0]];
      line(vertices, .85, 1);
      vertices.slice(0, -1).forEach(point => { line([point, [0, 0, 50]], .25); node(...[point[0], point[1], 1.6]); });
      line([[-130, 0, 15], [0, 0, 15], [127, -28, 15]], .6, .8, true);
      line([[0, 0, 15], [127, 28, 15]], .25, .5, true);
      if (id === "evaluations") for (const x of [-1, 1]) for (const y of [-1, 1]) line([[x * 85, y * 117, 0], [x * 117, y * 117, 0], [x * 117, y * 85, 0]], .3);
      node(0, 0, 2, 50);
    } else if (id === "settings" || id === "integrations") {
      sphere(28, [0, 0, 0], 300);
      if (id === "settings") {
        [58, 85, 115].forEach((r, i) => { ring(r, .18 * i, .3 * i, [0, 0, 0], .4); node(Math.cos(i * 2.1 - 1) * r, Math.sin(i * 2.1 - 1) * r, 2.5); });
        for (let i = 0; i < 48; i++) {
          const a = i / 48 * TAU;
          line([[Math.cos(a) * 124, Math.sin(a) * 124, 0], [Math.cos(a) * (i % 4 ? 126 : 130), Math.sin(a) * (i % 4 ? 126 : 130), 0]], .25);
        }
      } else {
        ring(104, .15, 0, [0, 0, 0], .25);
        for (let j = 0; j < 6; j++) {
          const a = j / 6 * TAU;
          const x = Math.cos(a) * 104, y = Math.sin(a) * 104;
          line([[0, 0, -30], [x, y, 0]], .25, .6, true);
          ring(17, 0, 0, [x, y, 0], .6);
          node(x, y, 2);
        }
      }
    } else if (id === "onboarding") {
      for (let j = 0; j < 5; j++) ring(108 - j * 18, .28, 0, [j * 10 - 20, j * -7 + 14, j * 6], .15 + j * .14, .75, -.6, 5.4);
      node(20, -14, 3);
      line([[-120, 80, 0], [20, -14, 30]], .35, .7, true);
    } else if (id === "create-agent" || id === "running") {
      for (let j = 0; j < 7; j++) {
        line(Array.from({ length: 150 }, (_, i) => {
          const f = i / 149, r = 10 + f * 120;
          const a = f * (id === "running" ? 7 : 3) + j / 7 * TAU;
          return [Math.cos(a) * r, Math.sin(a) * r * .7, Math.sin(a) * r * .35];
        }), .14 + j * .05, .6, true);
      }
      sphere(21, [0, 0, 0], 300);
      node(0, 0, 3, 24);
      for (let j = 0; j < 330; j++) {
        const a = rand() * TAU, r = 28 + rand() * 105;
        dot(Math.cos(a) * r, Math.sin(a) * r * .7, 0, .5, .1 + rand() * .3);
      }
    } else if (id === "analytics") {
      scene.flat = true;
      for (let j = 0; j < 6; j++) line([[-125, -80 + j * 32, 0], [125, -80 + j * 32, 0]], .1);
      for (let j = 0; j < 9; j++) line([[-125 + j * 31, -80, 0], [-125 + j * 31, 80, 0]], .07);
      for (let j = 0; j < 2; j++) {
        const points = Array.from({ length: 180 }, (_, i) => { const x = -125 + i / 179 * 250; return [x, Math.sin(x / 39 + j * 2) * 38 + Math.cos(x / 73) * 20, 0]; });
        line(points, j ? .3 : .9, j ? .7 : 1.1, true);
        for (let k = 15; k < points.length; k += 36) node(points[k][0], points[k][1], j ? 1 : 2);
      }
    } else if (id === "outreach") {
      scene.flat = true;
      node(-55, 0, 4);
      for (let j = 0; j < 5; j++) ring(35 + j * 23, 0, 0, [-55, 0, 0], .75 - j * .12, .8, -1.1, 1.1);
      line([[-55, 0, 0], [118, -50, 0]], .2, .6, true);
      line([[-55, 0, 0], [118, 50, 0]], .2, .6, true);
    }
    return scene;
  }
  function project(point, time = 0, flat = false) {
    const [x, y, z = 0] = point;
    const angle = flat ? 0 : Math.sin(time * .16) * .16;
    const xx = x * Math.cos(angle) + z * Math.sin(angle);
    const zz = z * Math.cos(angle) - x * Math.sin(angle);
    const scale = 500 / (500 - zz);
    return [160 + xx * scale, 160 + y * scale, scale];
  }
  function svg(item) {
    const scene = createScene(item.id);
    const p = point => project(point, 0, scene.flat).slice(0, 2).map(value => value.toFixed(2)).join(",");
    const surfaces = scene.surfaces.map(({ center, radius }) => `<circle cx="${project(center)[0]}" cy="${project(center)[1]}" r="${radius}" fill="url(#surface)"/>`).join("");
    const lines = scene.lines.map(({ points, alpha, width }) => {
      const coordinates = points.map(p).join(" ");
      return `${alpha > .7 ? `<polyline points="${coordinates}" fill="none" stroke="white" stroke-opacity=".1" stroke-width="${width + 2}"/>` : ""}<polyline points="${coordinates}" fill="none" stroke="white" stroke-opacity="${alpha}" stroke-width="${width}"/>`;
    }).join("");
    const dots = scene.dots.map(dot => {
      const [x, y, scale] = project([dot.x, dot.y, dot.z], 0, scene.flat);
      return `${dot.beacon ? `<circle cx="${x}" cy="${y}" r="${dot.radius * 4}" fill="url(#halo)"/>` : ""}<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(dot.radius * scale).toFixed(2)}" fill="white" fill-opacity="${dot.alpha}"/>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-labelledby="title"><title id="title">NTOX ${item.label}: ${item.name}</title><defs><radialGradient id="surface" cx="25%" cy="15%" r="85%"><stop stop-color="#242424"/><stop offset=".32" stop-color="#080808"/><stop offset="1" stop-color="#020202"/></radialGradient><radialGradient id="halo"><stop stop-color="white" stop-opacity=".6"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs>${surfaces}${lines}${dots}</svg>`;
  }
  function icon(item) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" role="img" aria-labelledby="title"><title id="title">${item.label}</title>${item.icon}</svg>`;
  }
  Object.assign(globalThis.NTOXGlyphs, { createScene, project, svg, icon });
})();
