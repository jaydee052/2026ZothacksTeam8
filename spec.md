# Office Hours Priority Queue

## Summary

A priority queue application for students and professors to queue their questions and topics for office hours. It has two parts: student and professor.

- **Student part:** a simple input for their question. It outputs a number in the queue based on the relevance/importance of the question.
- **Professor part:** view of the queue, changing the queue, and other management features.

## Tech Stack

- **Front end:** React
- **Back end:** Flask
- **Database:** SQLite

## Features

### Must-haves

**Student end**

- Display the queue
- Input box with type of question
- Logic for prioritizing the queue
- Upload syllabus to get office hour data

**Professor end**

- Display the queue
- Change timing and location of office hours
- Push remaining people still waiting to the next office hours once office hours close
- Be able to change the queue

### Nice-to-haves

- Group similar questions
- TA office hours
- Bump to TA office hours if professor office hours are overflowing, or at the beginning depending on the question


## Input (Student)

1. Student name
2. Class section
3. Question (25-word limit)
4. Question category

## Categories

- Quick Q&A
- Understanding Topic
- Grading
- Scheduling / Logistics
- Research
- Personal

## Priority Formula

```
Priority Score = ((Base Time) + (Complex × 3) + (Student × 5)) × Overflow
```

| Term | Meaning |
|------|---------|
| Base Time | Estimated time for the question |
| Complex | Difficulty: 1 = quick, 3 = understanding, 5 = conceptual |
| Student | Number of students with the same question |
| Overflow | Overflow term: 1 for first time, x2 for each day overflowed |

**Open question:** does the highest or lowest score get served first? As written, the highest score would rank long, complex questions ahead of quick ones.

## Overflow Logic

If a question doesn't fit in office hours:

- **TA queue** → priority boost because they were waiting
- **Next office hours** → priority boost to the front of the line

## OH Data

- Professor uploads syllabi for the quarter

## Data for Classes

- Anteater API

## Manual Changing

- Boolean flag on each queue entry: `True` if manually changed, `False` if not
- A pinned entry gets priority at the index it was pinned to

## Other Features

- TA queues
- Changing times
