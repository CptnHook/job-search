---
framework_version: 1.0.2
---

# Cover Letter Templates and Tailoring Guide

## Template: Custom cover.cls (XeLaTeX)

Cover letters use a custom LaTeX document class (`cover.cls`) with Lato/Raleway fonts.

**Output file:** `cover_letters/cover_<company>_<role>.tex`
**Compile with:** XeLaTeX (cover.cls requires fontspec)
**Font directory:** `cover_letters/OpenFonts/fonts/`

### Compile command

```bash
cd cover_letters && xelatex -interaction=nonstopmode cover_<company>_<role>.tex
```

Expected output: `Output written on cover_<company>_<role>.pdf (1 page, ...)`. Any page count other than 1 is a failure that must be fixed before presenting to the user.

## Compile-and-Inspect Loop (MANDATORY)

After writing the cover letter and before presenting to the user, always compile and visually inspect the PDF. Iterate until the layout is clean:

1. Run `xelatex -interaction=nonstopmode cover_<company>_<role>.tex`
2. Confirm page count is exactly 1 and compile succeeded
3. Read the PDF via the Read tool and visually check: signature fits at the bottom, no text cut off, bullet font matches body

### Known template pitfall: itemize inside `\lettercontent{}`

The `\lettercontent{}` macro appends `\\` to its argument. This breaks when the argument ends in `\end{itemize}` because `\\` has no line to break after the environment closes, producing `! LaTeX Error: There's no line here to end.` and no PDF output.

**Wrong (breaks compile):**
```latex
\lettercontent{Here is how my experience maps:
\begin{itemize}
    \item ...
\end{itemize}}
```

**Correct — close `\lettercontent{}` before the list and wrap the list in the matching Raleway-Medium font so typography stays consistent:**
```latex
\lettercontent{Here is how my experience maps:}

{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont
\begin{itemize}
    \item ...
\end{itemize}\par}
\vspace{6pt}

\lettercontent{[next paragraph]}
```

The font wrapper is mandatory — if you just move `\begin{itemize}` outside `\lettercontent{}` without the `\fontspec` block, bullets render in the default body font (Lato) and visually mismatch the rest of the letter.

## Document Structure

```latex
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Cover Letter - [Company], [Role]
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

\documentclass[]{cover}
\usepackage{fancyhdr}

\pagestyle{fancy}
\fancyhf{}

\rfoot{Page \thepage \hspace{0pt}}
\thispagestyle{empty}
\renewcommand{\headrulewidth}{0pt}
\begin{document}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%     TITLE NAME
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
\namesection{}{\Huge{Casey Caster}}{  \href{mailto:casey.caster@gmail.com}{casey.caster@gmail.com} | 650.799.9926 |  \urlstyle{same}\href{https://www.linkedin.com/in/caster/}{LinkedIn}
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%     MAIN COVER LETTER CONTENT
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

\currentdate{\today}
\lettercontent{Dear [Name/Team],}

\lettercontent{[Opening paragraph - role, connection to background, 2-3 sentences]}

\lettercontent{[Body paragraph - most relevant experience, introducing the bullet list]}

{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont
\begin{itemize}
    \item {[Concrete achievement/skill 1]}
    \item {[Concrete achievement/skill 2]}
    \item {[Concrete achievement/skill 3]}
\end{itemize}\par}

\lettercontent{[Connection to company - why this role, why this company specifically]}

\lettercontent{[Personal fit paragraph - behavioral strengths, team contribution, 2-3 sentences]}

\lettercontent{I look forward to hearing from you.}

\begin{flushright}
% No trailing \\ inside \closing{} - cover.cls appends its own \\, and a
% doubled break triggers "! LaTeX Error: There's no line here to end."
\closing{Kind regards,}

\signature{Casey Caster}
\end{flushright}
\end{document}
```

## Key Commands Reference

| Command | Purpose |
|---------|---------|
| `\namesection{}{Name}{contact info}` | Header with name and contact |
| `\currentdate{date}` | Date field (use `\today` or explicit date) |
| `\lettercontent{text}` | Body paragraph (adds spacing after) |
| `\closing{text}` | Closing line |
| `\signature{name}` | Printed name below signature |

## Owner's Preferred Letter (use as the model)

Casey chose his "Casey_Caster_Executive_Cover_Letter" Google Doc as the letter to use for applications. Its bracketed fields ([Date], [Hiring Manager Name], [Company Name], [Job Title]) are filled per job. Follow its structure and tone in the cover.cls template above:

1. **Opening:** interest in the [Job Title] role at [Company]; "experienced software executive" with customer-facing delivery, digital transformation, vendor management, and engineering leadership; connects customer needs and technical decisions to business priorities (delivery, operational performance, cost efficiency).
2. **Current role:** one line on leading engineering internal services at SingleStore. Tailor with one SingleStore result that fits the posting (ARR rescue, cloud spend, velocity, GenAI adoption, M&A).
3. **Bullets (3):** hundreds of large-scale implementations across the global financial industry (Ripple); a $20M program across sites and vendors with 300+ testers (Wells Fargo); $2M+ cost efficiency and engagement gains (Autodesk). Swap in the most relevant evidence from `01-candidate-profile.md`.
4. **How he leads:** collaboration; strong relationships with customers, colleagues, and vendors; bringing technical and business priorities together.
5. **What he'd do at [Company]:** align customer commitments with engineering priorities and business goals, set direction across teams and sites, weigh investment against delivery, risk, and cost. Make this specific to the posting.
6. **Close:** welcome a conversation about the [Job Title] role; thank them. Closing word: "Best,".

Rules for this letter:
- Plain, simple, straightforward tone. Run the draft through the humanizer skill before showing it.
- Keep to about one page (roughly 220-280 words of body text).
- Every career claim must be in `01-candidate-profile.md`. Choosing this letter doesn't confirm every claim in it.
- Header name is "Casey Caster" (his legal name), not the "Casey R. Caster Jr." in the Google Doc, unless he says otherwise.
- Use `\closing{Best,}` instead of "Kind regards,".

## Tailoring Guidelines

### Salutation
- If you know the hiring manager's name: "Dear [First Last],"
- If you know the team: "Dear [Company] hiring team,"
- Generic: "Dear [Company]," (avoid "To whom it may concern")

### Length - Hard 1-Page Limit
- Target: 1 page including signature block
- Maximum: **never exceed 1 page**
- **Word budget: 250-300 words** of body text (not counting LaTeX markup). This is the safe maximum. 350 words will overflow.
- **Always count**: opening paragraph + bullet list paragraph + closing paragraph = 3 blocks. Add a 4th only if the others are short.
- When adding company-specific content, trim other content to compensate rather than adding net length

### Line Spacing
- Add `\usepackage{setspace}` and `\setstretch{1.0}` if the letter is long and needs to fit on one page
- Use `\vspace{.5cm}` between major sections for readability (only if space permits)

### Bullet Lists
- Place `\begin{itemize}...\end{itemize}` **outside** a `\lettercontent{}` block (see "Known template pitfall" above), wrapped in the matching Raleway-Medium `\fontspec` so the bullet font matches the body
- 3-5 bullets is ideal
- Start each bullet with bold label or action verb
- Use `\textbf{Label:}` for category-style bullets
- A bullet whose text begins with a literal `[` must be braced: `\item {[text]}`. Unbraced, LaTeX parses `[text]` as `\item`'s optional label and renders it off the left page edge, missing from the PDF text layer entirely

### LaTeX Special Characters
Escape these wherever they appear in body text:
- Ampersand: `\&` (company names: Brüel \& Kjær, H\&M) - unescaped, the compile fails loudly
- Percent: `\%` ("grew revenue 30\%") - unescaped, it does **not** fail: everything after the `%` on that line is silently eaten as a LaTeX comment
- Dollar: `\$`, hash: `\#`, underscore: `\_`
- Tilde: `\textasciitilde{}`, caret: `\textasciicircum{}`, backslash: `\textbackslash{}`

### Non-English Cover Letters
- Same template structure, just write content in the posting's language
- Adjust date format to local convention
- Adjust closing to local convention (e.g. "Med venlig hilsen," for Danish)

## Checklist Before Finalizing
- [ ] No em-dashes (use commas or periods instead)
- [ ] No cliches or empty filler
- [ ] Every claim backed by specific example
- [ ] Forward-looking framing: focuses on tasks you'll solve, not just past duties
- [ ] Motivation section references this specific company's mission/values
- [ ] Company name and role are correct throughout
- [ ] Date is current
- [ ] Fits on one page
- [ ] Language matches the job posting language
- [ ] Salutation is appropriate (named person if possible)
- [ ] Headline is engaging and specific, not generic

## Submission Guidelines (Best Practice)
- Submit only the documents the employer requests
- Export as PDF to preserve formatting
- Name files clearly: "[Your Name] CV" and "[Your Name] Cover Letter"
- Follow all employer instructions regarding anonymity or specific materials
