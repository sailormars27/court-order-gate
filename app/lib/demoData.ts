export const section1 = {
  id: "pco-1-insurance",
  section: "1",
  title: "Insurance Coverage",

  raw: {
    actor: "Δ",
    deadline: "9/15/23",
    text: "If not already provided, shall be furnished by Δ on or before 9/15/23"
  },

  interpreted: {
    actor: "Defendant",
    action: "furnish insurance coverage information",
    condition: "if not already provided",
    deadline: "2023-09-15"
  },

  approvals: {
    actor: false,
    deadline: false,
    interpretation: false
  },

  risk: "high",
  exportable: false,

  source: {
    page: 1
  }
};
