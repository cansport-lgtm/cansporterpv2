// Single source of truth for currency formatting in the Online Sales module.
// The business operates in Pakistani Rupees (PKR). Use these helpers everywhere
// instead of hardcoding "₹" / "Rs." so the module stays consistent.

/** Format a number as PKR with a "Rs." prefix, e.g. 1234.5 -> "Rs. 1,235". */
export const formatPKR = (n: number | null | undefined): string =>
  `Rs. ${Math.round(Number(n) || 0).toLocaleString()}`;

/** PKR symbol/label for use in table headers and inline labels, e.g. "Value (Rs.)". */
export const PKR = "Rs.";
