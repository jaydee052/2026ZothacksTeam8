"""Labeled question pairs for tuning similar-question matching (similarity.py).

Each case is (question_a, question_b, same):
  same = True   the professor could answer both at once (same group)
  same = False  different questions, even if they share words

Add real student questions here as you get them, then run:
    python tests/check_similarity.py
"""

SAME = [
    # recursion
    ("Can you explain how recursion works?", "I dont understand recursion"),
    ("My recursive function never stops", "recursion goes forever, base case not working"),
    ("Why does my recursive flatten() return None?", "flatten function returns None for nested lists"),
    ("How do I debug a RecursionError?", "getting maximum recursion depth exceeded"),
    ("how do i write the base case for recursion", "not sure what my base case should be"),
    # files
    ("How do file paths work with open()?", "open() can't find my file"),
    ("FileNotFoundError when opening my txt file", "python says file not found but its in the folder"),
    ("how do I read a file line by line", "reading lines from a text file"),
    ("how to use pathlib Path objects", "confused about Path from pathlib"),
    ("Why is my file empty after writing to it?", "nothing gets written to my output file"),
    # errors / debugging
    ("IndexError list index out of range", "getting index out of range error on my list"),
    ("KeyError when accessing my dictionary", "dict gives KeyError even though key exists"),
    ("my while loop never ends", "infinite loop in my while statement"),
    ("TypeError: 'NoneType' object is not subscriptable", "NoneType not subscriptable error"),
    ("ModuleNotFoundError when importing my other file", "cant import my module, says not found"),
    ("what does a try except block do", "how do exceptions and try/except work"),
    # data structures
    ("difference between a list and a tuple", "when should I use a tuple instead of a list"),
    ("how do list comprehensions work", "confused by list comprehension syntax"),
    ("how to sort a dictionary by value", "sorting dict by its values"),
    ("how do I loop through a dictionary", "iterating over a dict keys and values"),
    ("what is a generator and when to use yield", "confused about yield in generators"),
    # classes
    ("What does self mean in a class?", "confused about self in python classes"),
    ("how does __init__ work", "what is the __init__ method for"),
    ("what is inheritance in python classes", "how do subclasses inherit from a parent class"),
    ("difference between class attributes and instance attributes", "class variable vs instance variable"),
    # networking (ICS 32 projects)
    ("how do sockets work for project 2", "confused about socket connections"),
    ("my socket connection keeps getting refused", "connection refused error with socket"),
    ("how do I send and receive messages over a socket", "socket send and recv not working"),
    # gui
    ("tkinter window doesnt show up", "my tkinter GUI window is not appearing"),
    ("how do I bind a click event in tkinter", "tkinter button click event binding"),
    ("canvas resizing in tkinter", "how to make tkinter canvas resize with window"),
    # testing
    ("how do I write unit tests", "confused about unittest and writing tests"),
    ("what is assertEqual in unittest", "how do assert statements work in unit tests"),
    # assignments / grading / logistics
    ("Why did I lose points on assignment 3?", "lost points on assignment 3 part B"),
    ("Can I get an extension on hw 2?", "extension for homework 2"),
    ("When is the midterm?", "what day is the midterm exam"),
    ("what topics are on the midterm", "what should I study for the midterm"),
    ("how do i submit project 1", "where do we turn in project 1"),
    ("regrade request for project 2", "I think project 2 was graded wrong, can I get a regrade"),
    ("what does project 3 part 2 want us to do", "confused about the requirements for project 3 part 2"),
    ("is the final cumulative", "does the final cover everything from the quarter"),
    ("how is the final grade calculated", "what are the grade weights for the class"),
    ("can I switch my lab section", "how do I change discussion sections"),
    ("How do I cite sources?", "citing sources in my paper"),
    # setup / tools
    ("how do I install python on mac", "python installation on macbook"),
    ("how do I set up a virtual environment", "creating a venv for the project"),
    ("git push keeps getting rejected", "rejected when pushing to github"),
    ("how to undo a git commit", "reverting my last commit in git"),
    ("pip install not working", "cant install packages with pip"),
    ("IDLE keeps freezing", "my idle editor freezes every time i run code"),
    # informal / typos
    ("wats a dictonary", "what is a dictionary in python"),
    ("recurson help pls", "need help with recursion"),
    ("my code for p2 crashes on startup", "project 2 crashes as soon as I run it"),
    ("hw3 q4 confused", "stuck on homework 3 question 4"),
    ("lambda functions??", "what are lambda functions"),
    ("idk how to use enumerate", "how does enumerate work in a for loop"),
    ("string slicing confusing", "how does slicing strings work"),
    ("f strings vs format", "difference between f-strings and .format()"),
    ("whats the diff between == and is", "== vs is in python"),
    ("global variable not changing inside function", "why cant my function modify a global variable"),
]

DIFFERENT = [
    # same assignment, different question (near misses)
    ("Why did I lose points on assignment 3?", "When is assignment 4 due?"),
    ("When is project 2 due?", "Can I get an extension on project 2?"),
    ("What does project 3 part 2 want us to do?", "Why did I lose points on project 3 part 2?"),
    ("Why did I lose points on assignment 3?", "When is assignment 3 due?"),
    ("how do i submit project 1", "regrade request for project 1"),
    ("hw3 q4 confused", "hw3 q5 confused"),
    ("project 2 socket connection refused", "project 2 tkinter window not showing"),
    ("lost points on assignment 3 part B", "lost points on assignment 3 part A"),
    ("When is the midterm?", "When is the final?"),
    ("what topics are on the midterm", "when are midterm grades coming out"),
    # same technical area, different problem
    ("How do I read a file line by line?", "How do I write to a file?"),
    ("IndexError list index out of range", "KeyError when accessing my dictionary"),
    ("how to sort a dictionary by value", "how to delete a key from a dictionary"),
    ("difference between a list and a tuple", "how do list comprehensions work"),
    ("What does self mean in a class?", "what is inheritance in python classes"),
    ("how do sockets work", "how do I bind a click event in tkinter"),
    ("my while loop never ends", "my for loop skips the last item"),
    ("git push keeps getting rejected", "how to undo a git commit"),
    ("how do I install python on mac", "how do I install python on windows"),
    ("My recursive function never stops", "My while loop never stops"),
    ("FileNotFoundError when opening my file", "ModuleNotFoundError when importing my file"),
    ("how do I write unit tests", "how do I write a recursive function"),
    ("tkinter window doesnt show up", "tkinter canvas resizing"),
    ("what is a generator", "what is a decorator"),
    ("string slicing confusing", "list slicing with negative step"),
    # unrelated
    ("When is the midterm?", "Can you explain how recursion works?"),
    ("What is a linked list?", "How do dictionaries work in Python?"),
    ("Why did I lose points on assignment 3?", "regrade request for midterm"),
    ("How do I set up my Python environment?", "What is a linked list?"),
    ("help", "How do I cite sources?"),
    ("can I switch my lab section", "how does __init__ work"),
    ("pip install not working", "how is the final grade calculated"),
    ("lambda functions??", "what is a tuple"),
    ("IDLE keeps freezing", "socket send and recv not working"),
    ("is the final cumulative", "what does self mean"),
    ("how do i submit project 1", "how do sockets work"),
    ("my code crashes", "my code is slow"),
    ("whats the diff between == and is", "whats the diff between a list and a set"),
    ("global variable not changing inside function", "function returns None instead of a value"),
    ("Can I get an extension on hw 2?", "Can you explain hw 2 question 3?"),
    ("office hours location?", "what is on the midterm"),
    ("how do i use enumerate", "how do i use zip"),
    ("f strings vs format", "how do I round a float to 2 decimals"),
    ("python says file not found but its in the folder", "python says indentation error"),
    ("what does a try except block do", "what does a with statement do"),
]

# Second batch, written after the first round of tuning to check it on questions
# it hadn't seen (it got 32/40 before the fixes these led to).
SAME += [
    ("how do I open a csv file", "reading a csv file in python"),
    ("what does return do in a function", "difference between print and return"),
    ("my program says ValueError invalid literal for int", "ValueError when converting input to int"),
    ("how do classes and objects work", "confused about objects and classes"),
    ("when is project 4 due", "project 4 deadline?"),
    ("can I get extra time on lab 5", "extension for lab 5"),
    ("why did i get a 0 on quiz 2", "quiz 2 grade is wrong"),
    ("how do nested loops work", "confused by loops inside loops"),
    ("how do I make a list of lists", "creating a 2d list"),
    ("what is the time complexity of my sort", "big O of sorting"),
    ("how do I parse command line arguments", "using sys.argv for arguments"),
    ("socket recv hangs forever", "my socket receive call never returns"),
    ("tkinter label text wont update", "updating a label in tkinter"),
    ("how to use a while True loop with break", "breaking out of a while true loop"),
    ("git merge conflict help", "how do I fix merge conflicts in git"),
    ("whats the point of __name__ == '__main__'", "what does if __name__ == __main__ do"),
    ("my dictionary keys are out of order", "dict not keeping insertion order"),
    ("how do I compare two strings ignoring case", "case insensitive string comparison"),
    ("KeyError in project 3", "getting a KeyError on project 3"),
    ("how do default arguments work", "default parameter values in functions"),
]

DIFFERENT += [
    ("when is project 4 due", "when is project 5 due"),
    ("why did i get a 0 on quiz 2", "when is quiz 3"),
    ("how do I open a csv file", "how do I open a socket"),
    ("ValueError converting input to int", "TypeError adding string and int"),
    ("how do nested loops work", "how do nested dictionaries work"),
    ("tkinter label text wont update", "tkinter button doesnt do anything"),
    ("git merge conflict help", "git clone permission denied"),
    ("can I get extra time on lab 5", "what is lab 5 asking us to do"),
    ("how do I make a list of lists", "how do I reverse a list"),
    ("project 2 part 1 confused", "project 2 part 3 confused"),
    ("how do classes work", "how do sockets work"),
    ("what is the time complexity of my sort", "my sort function crashes"),
    ("how to install tkinter on windows", "how to install tkinter on mac"),
    ("regrade for midterm question 2", "regrade for midterm question 5"),
    ("whats on the final", "where is the final"),
    ("how do I compare two strings ignoring case", "how do I split a string by commas"),
    ("my code passes locally but fails the autograder", "how do I install the autograder tools"),
    ("default arguments", "keyword arguments"),
    ("how do I use break", "how do I use continue"),
    ("office hours tomorrow?", "is the midterm curved"),
]

CASES = [(a, b, True) for a, b in SAME] + [(a, b, False) for a, b in DIFFERENT]
