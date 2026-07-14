Contract-Version: 1.0.0

# Bounded Repair

A repair request names findings, allowed files and change categories, protected behavior/content/art-direction/API/state/accessibility/route invariants, and measurable pass criteria. Change only the named scope. Preserve all protected invariants, avoid unrelated refactors, and run regression checks after each iteration. Stop when hard gates pass, the iteration budget is exhausted, or work is blocked. A repair is complete only when fresh evidence satisfies every pass criterion without introducing a regression.
