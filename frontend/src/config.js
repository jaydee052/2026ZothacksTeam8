// The one place that says who is "logged in" and where the backend lives.
// There's no real login yet: screens read the student and professor from here and
// nowhere else, so swapping in real accounts later means changing this file.

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api'

// Which term to read from the Anteater API.
// The frontend asks Anteater directly, so the backend is not involved in class lookups.
export const ANTEATER_TERM = { year: '2026', quarter: 'Fall' }

// Hardcoded student. Their classes are NOT listed here: on load the app looks up each
// section code (CRN) below on the Anteater API and shows whatever comes back.
// Add more 5-digit codes from the term above to enroll them in more classes.
// These are CURRENT_PROFESSOR's sections, so the student and professor see the same
// classes. If you change the professor, change these codes to match.
export const CURRENT_STUDENT = {
  id: 1,
  name: 'Jordan Lee',
  crns: ['34190', '35400'], // COMPSCI 161 Lec A, COMPSCI 260P Lec A (Fall 2026, both taught by Shindler)
}

// Hardcoded professor. Their courses for the term come from the Anteater API,
// looked up by UCInetID (the part of their email before @uci.edu). Pick someone who
// taught in the term above, or the dashboard will be empty.
export const CURRENT_PROFESSOR = {
  ucinetid: 'mikes',
}
