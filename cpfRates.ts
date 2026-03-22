/**
 * CPF Contribution Rates
 * Source: CPF Board — effective 1 January 2026
 * https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay
 *
 * To update: change the rates below and bump CPF_RATES_EFFECTIVE_DATE.
 */

export const CPF_RATES_EFFECTIVE_DATE = '1 Jan 2026';

export const CPF_RATES = {
  '55_and_below': { label: '55 and below',      employer: 0.17,   employee: 0.20  },
  '55_to_60':     { label: 'Above 55 to 60',    employer: 0.16,   employee: 0.18  },
  '60_to_65':     { label: 'Above 60 to 65',    employer: 0.125,  employee: 0.125 },
  '65_to_70':     { label: 'Above 65 to 70',    employer: 0.09,   employee: 0.075 },
  'above_70':     { label: 'Above 70',           employer: 0.075,  employee: 0.05  },
} as const;

export type AgeGroup = keyof typeof CPF_RATES;

/**
 * Calculate employee and employer CPF contributions.
 *
 * Bands (MOM rules):
 *   grossPay > $750      → full employee + employer CPF
 *   $500 < gross ≤ $750  → graduated employee CPF on (gross - 500) only; employer on full gross
 *   $50  < gross ≤ $500  → no employee CPF; employer CPF on full gross
 *   gross ≤ $50          → no CPF at all
 */
export function calculateCpf(grossPay: number, ageGroup: AgeGroup): { employeeCpf: number; employerCpf: number } {
  const rates = CPF_RATES[ageGroup];
  let employeeCpf = 0;
  let employerCpf = 0;

  if (grossPay > 750) {
    employeeCpf = grossPay * rates.employee;
    employerCpf = grossPay * rates.employer;
  } else if (grossPay > 500) {
    employeeCpf = (grossPay - 500) * rates.employee;
    employerCpf = grossPay * rates.employer;
  } else if (grossPay > 50) {
    employerCpf = grossPay * rates.employer;
  }

  return { employeeCpf, employerCpf };
}
