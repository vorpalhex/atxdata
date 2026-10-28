---
name: finding-highlights
description: "Use this skill to discover how to pull highlights from a large document that a given reader would find useful."
version: 0.1.0
---

# Finding Highlights

This skill is about surfacing a subset of useful items to the human reader.

## When to Use

Use this anytime the user asks you to scan a document, give you highlights or find interesting bulletpoints. You should be explicit that you are using this skill and work with your operator on which persona(s) you are leveraging.

## Procedure

1. Pick a persona from the personas/ folder after working with your human operator to decide. We like running both the city-council watcher and budget reader, but discuss with your operator.
2. Read that persona's description and act as that persona, noting each item in the document(s) that give you a strong initial impression. Every item you note should include the full document name, the page, the in-document label for that item (eg Section 2 Item 3), that item's formal title in the document, along with a brief description of why it raised your ire.
3. When your list is complete, re-verify the item, making sure it's page and other indicators are correct.
4. If you contain any math backed claims, you MUST triple check your work. Your triple check must be in-line. Every check must be fully independent (eg use separate sub-agents starting from the initial document). 

## Supporting Files

Two starter personas exist in the ./personas folder in this skill. If the operator is displeased or feels you are selecting the wrong points, help them define and build a new persona. Encourage them to use natural language and try to describe a specific person, and then help generalize that. Personas operate better when they are brief.

## Pitfalls

LLMs can write significantly more than a human can read. Even summarizing a document thoroughly may be too much. However, failing to raise the right items can also be dangerous. When in doubt, run every persona in the stack to highlight items and then use the preferred persona to review the entire list.

## Verification

Verify every discovered item matches for it's title, it's page number, it's in-document location and that the description seems accurate.

Triple verify any math claims (eg budgets or claims of math errors). Triple verification must be written out for the user. This is non-negotiable.
