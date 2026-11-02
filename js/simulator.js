(function () {
  const STATES = {
    "0000": "IDLE",
    "0100": "GOT_1",
    "0101": "GOT_10",
    "0110": "GOT_101",
    "0111": "SUCCESS",
    "1000": "ERR_1",
    "1001": "ERR_2",
    "1010": "ERR_3",
    "0011": "LOCKED"
  };

  const sim = {
    arch: "unified",
    cycle: 0,
    mask: [0, 0, 0, 0], // [b3, b2, b1, b0]
    stateA: "0000",
    stateGolden: "0000",
    history: [],
    lastMaskUsed: "0000"
  };

  function xor4(a, b) {
    let out = "";
    for (let i = 0; i < 4; i++) out += (a[i] === b[i]) ? "0" : "1";
    return out;
  }

  function parity4(s) {
    let p = 0;
    for (let i = 0; i < 4; i++) if (s[i] === "1") p ^= 1;
    return p;
  }

  function weight4(s) {
    let w = 0;
    for (let i = 0; i < 4; i++) if (s[i] === "1") w++;
    return w;
  }

  function nextState(curr, bit) {
    switch (curr) {
      case "0000": return bit === 1 ? "0100" : "1000";
      case "0100": return bit === 0 ? "0101" : "1001";
      case "0101": return bit === 1 ? "0110" : "1010";
      case "0110": return bit === 0 ? "0111" : "0011";
      case "1000": return "1001";
      case "1001": return "1010";
      case "1010": return "0011";
      case "0111": return "0111";
      case "0011": return "0011";
      default:     return "0000";
    }
  }

  function stateLabel(code) {
    return `${code} (${STATES[code] || "CORRUPTED"})`;
  }

  function getMaskStr() {
    return `${sim.mask[0]}${sim.mask[1]}${sim.mask[2]}${sim.mask[3]}`;
  }

  function step(bit, customMaskStr) {
    const b = Number(bit);
    const maskStr = customMaskStr || getMaskStr();
    sim.lastMaskUsed = maskStr;
    sim.cycle += 1;
    sim.history.push(b);

    const nextG = nextState(sim.stateGolden, b);
    const baseA = (sim.arch === "sol4" || sim.arch === "sol6") ? sim.stateGolden : sim.stateA;
    const nextA = nextState(baseA, b);

    sim.stateGolden = nextG;
    sim.stateA = xor4(nextA, maskStr);

    // Reset mask toggles to 0000 after injection
    sim.mask = [0, 0, 0, 0];
    render();
  }

  function reset() {
    sim.cycle = 0;
    sim.mask = [0, 0, 0, 0];
    sim.stateA = "0000";
    sim.stateGolden = "0000";
    sim.history = [];
    sim.lastMaskUsed = "0000";
    render();
  }

  function render() {
    // Update mask buttons
    for (let i = 0; i < 4; i++) {
      const btn = document.getElementById(`maskBtn${i}`);
      if (btn) {
        btn.textContent = String(sim.mask[i]);
        btn.className = sim.mask[i]
          ? "w-11 h-11 rounded-lg border-2 border-red-500 bg-red-50 text-red-700 font-bold mono text-base transition"
          : "w-11 h-11 rounded-lg border border-slate-300 bg-white text-slate-800 font-semibold mono text-base hover:bg-slate-50 transition";
      }
    }
    const maskPreview = document.getElementById("maskPreview");
    if (maskPreview) maskPreview.textContent = getMaskStr();

    // Compute outputs based on current stateA, stateGolden, and lastMaskUsed
    const wt = weight4(sim.lastMaskUsed);
    const hasFault = sim.stateA !== sim.stateGolden;
    const parityErr = (parity4(sim.stateA) !== parity4(sim.stateGolden)) ? 1 : 0;
    const dmrErr = hasFault ? 1 : 0;
    const tmrErr = hasFault ? 1 : 0;
    const votedState = sim.stateGolden; // 2-out-of-3 majority matches Golden B & C

    const eccErr = hasFault ? 1 : 0;
    const eccCorr = (wt === 1 && hasFault) ? 1 : 0;
    const eccUnc = (wt > 1 && hasFault) ? 1 : 0;
    const eccState = eccCorr ? sim.stateGolden : sim.stateA;

    const rawAccess = (sim.stateA === "0111") ? 1 : 0;
    let finalAccess = rawAccess;
    let attackDetected = 0;

    if (sim.arch === "baseline") {
      finalAccess = rawAccess;
      attackDetected = 0;
    } else if (sim.arch === "sol1" || sim.arch === "sol2") {
      attackDetected = parityErr;
      finalAccess = (rawAccess && !parityErr) ? 1 : 0;
    } else if (sim.arch === "sol3") {
      attackDetected = (wt === 1 && hasFault) ? 1 : 0;
      finalAccess = (rawAccess && !attackDetected) ? 1 : 0;
    } else if (sim.arch === "sol4") {
      attackDetected = eccErr;
      finalAccess = (!eccUnc && eccState === "0111") ? 1 : 0;
    } else if (sim.arch === "sol5") {
      attackDetected = dmrErr;
      finalAccess = (rawAccess && !dmrErr) ? 1 : 0;
    } else if (sim.arch === "sol6") {
      attackDetected = tmrErr;
      finalAccess = (votedState === "0111") ? 1 : 0;
    } else {
      // Unified
      attackDetected = (parityErr | dmrErr | tmrErr | eccErr) ? 1 : 0;
      finalAccess = (votedState === "0111" && !dmrErr) ? 1 : 0;
    }

    setText("outCycle", String(sim.cycle));
    setText("outHistory", sim.history.length ? sim.history.join(" → ") : "None");
    setText("outMaskUsed", sim.lastMaskUsed);
    setText("outStateA", stateLabel(sim.stateA));
    setText("outStateGolden", stateLabel(sim.stateGolden));

    const elAccess = document.getElementById("outAccess");
    if (elAccess) {
      if (finalAccess === 1 && sim.stateGolden !== "0111") {
        elAccess.textContent = "1 — UNAUTHORIZED BYPASS!";
        elAccess.className = "mono font-bold text-red-600";
      } else if (finalAccess === 1) {
        elAccess.textContent = "1 — ACCESS GRANTED";
        elAccess.className = "mono font-bold text-emerald-600";
      } else {
        elAccess.textContent = "0 — ACCESS DENIED";
        elAccess.className = "mono font-semibold text-slate-700";
      }
    }

    const elAttack = document.getElementById("outAttack");
    if (elAttack) {
      elAttack.textContent = attackDetected ? "1 — FAULT DETECTED" : (hasFault ? "0 — MISSED (UNDETECTED)" : "0 — NONE");
      elAttack.className = attackDetected
        ? "mono font-bold text-amber-600"
        : (hasFault ? "mono font-bold text-red-600" : "mono text-slate-600");
    }

    setText("outParity", hasFault ? (parityErr ? "1 (Detected)" : "0 (Blind to Even-Bit Fault)") : "0 (OK)");
    setText("outDmr", dmrErr ? "1 (Mismatch Caught)" : "0 (Match)");
    setText("outTmr", `${stateLabel(votedState)}${tmrErr ? " — Masked Fault" : ""}`);
    setText(
      "outEcc",
      eccCorr
        ? `${stateLabel(eccState)} — 1-Bit Corrected`
        : (eccUnc ? "Uncorrectable Multi-Bit (Locked)" : `${stateLabel(eccState)} — Clean`)
    );

    const statusBox = document.getElementById("statusBox");
    if (statusBox) {
      if (sim.cycle === 0) {
        statusBox.textContent = "FSM is in IDLE (0000). Enter bits 1 → 0 → 1 → 0 to unlock.";
        statusBox.className = "p-3 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-sm";
      } else if (finalAccess === 1 && sim.stateGolden !== "0111") {
        statusBox.textContent = `Security Breach! Fault mask ${sim.lastMaskUsed} flipped state to SUCCESS (0111).`;
        statusBox.className = "p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium";
      } else if (hasFault && finalAccess === 0) {
        statusBox.textContent = `Fault injected (mask ${sim.lastMaskUsed}), but hardware defense blocked unauthorized access.`;
        statusBox.className = "p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm font-medium";
      } else if (finalAccess === 1) {
        statusBox.textContent = "Correct PIN (1010) entered! State is SUCCESS (0111) and Access is Granted.";
        statusBox.className = "p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium";
      } else {
        statusBox.textContent = `Step ${sim.cycle}: Current State is ${stateLabel(sim.stateA)}.`;
        statusBox.className = "p-3 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-sm";
      }
    }
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  window.SIM = {
    setArch(val) {
      sim.arch = val;
      reset();
    },
    toggleMaskBit(idx) {
      sim.mask[idx] = sim.mask[idx] ? 0 : 1;
      render();
    },
    stepBit(b) {
      step(b);
    },
    reset,
    presetValid() {
      reset();
      [1, 0, 1, 0].forEach(b => step(b, "0000"));
    },
    presetWrong() {
      reset();
      [0, 0, 0, 0].forEach(b => step(b, "0000"));
    },
    presetBypass1Bit() {
      reset();
      [0, 0, 0, 0].forEach(b => step(b, "0000")); // Reaches LOCKED (0011)
      step(0, "0100"); // 0011 ^ 0100 = 0111 (SUCCESS)
    },
    presetBypassEven() {
      reset();
      step(0, "1111"); // Expects ERR_1 (1000) ^ 1111 = 0111 (SUCCESS)
    }
  };

  window.addEventListener("DOMContentLoaded", reset);
})();
