// HackRate scores every idea against this FIXED, idea-level rubric. The goal is to
// test whether the IDEA itself would work — not to review code. So the dimensions are
// about the concept (is the problem real, is it novel, could a team demo it, does it
// fit the hackathon's criteria), not implementation details.
//
// A dimension: { key, label, description, weight, higherIsBetter, isCriteria? }
//   higherIsBetter:false = risk-style (10 = no problem)
//   isCriteria:true       = the "how well did it follow the given criteria" dimension,
//                           surfaced as its own section in the UI.

export const DIMENSIONS = [
  { key: "problem_clarity", label: "Problem Clarity", description: "The problem is clear, real, and worth solving.", weight: 2, higherIsBetter: true },
  { key: "novelty", label: "Novelty", description: "A fresh angle, not a thin copy of something that already exists.", weight: 2, higherIsBetter: true },
  { key: "feasibility_in_time", label: "Feasibility in Time", description: "A team could realistically build a working demo of this in a hackathon.", weight: 3, higherIsBetter: true },
  { key: "target_user_clarity", label: "Target User Clarity", description: "It's clear who this is for and why they'd use it.", weight: 2, higherIsBetter: true },
  { key: "impact_usefulness", label: "Impact / Usefulness", description: "The idea would genuinely be useful if it existed.", weight: 2, higherIsBetter: true },
  { key: "market_precedent", label: "Market Precedent", description: "Stands out from existing products solving the same problem.", weight: 2, higherIsBetter: true },
  { key: "demo_ability", label: "Demo-ability", description: "The concept is easy to show off convincingly in a short demo.", weight: 3, higherIsBetter: true },
  { key: "wow_factor", label: "Wow Factor", description: "Memorable — makes judges lean in.", weight: 2, higherIsBetter: true },
  { key: "criteria_fit", label: "Criteria Fit", description: "How well the idea follows the hackathon's stated criteria / theme.", weight: 3, higherIsBetter: true, isCriteria: true },
  { key: "clarity_of_spec", label: "Clarity of Spec", description: "The idea is well thought out with few unanswered questions (10 = no ambiguity).", weight: 1, higherIsBetter: false },
  { key: "scope_realism", label: "Scope Realism", description: "Not trying to do too much for one hackathon (10 = well-scoped).", weight: 1, higherIsBetter: false },
  { key: "tech_realism", label: "Tech Realism", description: "Relies only on real, affordable technology. Score low ONLY if it needs a capability or AI model that doesn't exist, or a prohibitively expensive dependency (10 = fine).", weight: 2, higherIsBetter: false },
  { key: "ethical_safety", label: "Ethical / Safety", description: "No serious ethical, privacy, or safety concerns (10 = none).", weight: 1, higherIsBetter: false },
];

// The criteria-adherence dimension, surfaced separately in the UI.
export const CRITERIA_DIMENSION = DIMENSIONS.find((d) => d.isCriteria);
