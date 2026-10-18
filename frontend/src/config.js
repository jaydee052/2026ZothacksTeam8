// The one place that says who is "logged in" and where the backend lives.
// There's no real login yet: screens read the student from here and nowhere else,
// so swapping in a real account later means changing this file (or what fills it).

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api'

export const CURRENT_STUDENT = {
  id: 1,
  name: 'Jordan Lee',
  section: 'Lec A',
  classes: ['ICS 32', 'ICS 33'],
}
