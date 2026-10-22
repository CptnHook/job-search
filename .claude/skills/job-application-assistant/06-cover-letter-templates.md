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

## Owner's Preferred Letter: Casey's brief (authoritative)

Source: Casey's Google Doc "cover-letter-brief.md" (https://docs.google.com/document/d/1M86xaBFQCV2c-D454kKH2-R420A38MsbjzlgxSOKCTw), written 2026-10-21. **It overrides everything else in this file and in `03-writing-style.md` about letter structure, tone, and company content.** If the Doc changes, re-read it and update this section.

**Core idea:** Casey is motivated by expanding what a business is capable of achieving. He judges success by how much more the business can accomplish because of what he built, not by team size or activity. Lead with outcomes; headcount, programs, and tools are the means.

**Voice:** first person, active verbs, contractions, conviction over hedging. No "I would be able to" hedges ("I'd go straight to" is fine). Plain, direct, a little dry is fine. At least one line showing his point of view on how organizations should work. No em dashes, no "not X, it's Y", no reflexive lists of three, no stock AI words, no chatbot sign-offs; vary sentence length. Run the humanizer checklist. Never invent facts; leave a bracketed slot and flag it.

**Structure** (one page, about 200-280 words of body):
1. Header: "Casey R. Caster Jr.", then: Pacifica, CA | 650-799-9926 | Casey.caster@gmail.com | www.linkedin.com/in/caster
2. Date, then hiring manager name and company name. No name: salutation "Dear [Company] Hiring Team," and the company name alone in the address block. No company description.
3. Opener (two sentences): conviction first, then why this role and company, with **one** specific connection to the company's ambitions or a recent release, tied to the operational challenge it creates (verify it independently).
4. Ripple paragraph, 5. SingleStore paragraph, 6. scale line, 7. close, 8. "Best," / "Casey Caster", per the template below.

**Template:**

> Dear [Hiring Manager Name],
>
> What excites me most is helping a business do what it didn't think it could. That's what draws me to the [VP Title] role at [Company Name], and in particular [specific connection to the company's ambitions].
>
> At Ripple, I started with four project managers who couldn't keep up with customer demand. That team grew into a global organization, and the result I point to is [business outcome: what Ripple or its customers could do afterward]. Along the way we built programs and tools that met customer needs without continually adding headcount.
>
> Today I lead Engineering Infrastructure & Internal Services at SingleStore with the same mindset. I give people clear direction, build what the business needs, and change course when a better opportunity shows up. I'll retire a structure I built the day it stops paying for itself. [SingleStore result.]
>
> The pattern holds at other scales. I led a $20M program across multiple sites and vendors, and I delivered more than $2M in cost efficiencies at a multinational software company.
>
> I'd like to hear where you want to take [Company Name] and talk about how I can help you get there faster.
>
> Best,
> Casey Caster

**Optional:** for customer-delivery roles, add the earlier-career line about driving hundreds of implementations and product upgrades for financial institutions worldwide. Never mention "TPMO"; describe the outcome instead.

**Slots Casey still owes (flag until he confirms):** the Ripple outcome; one SingleStore result phrased as what the business can now do; optionally what the $20M program and $2M savings made possible. Proposed fills from the profile, pending his confirmation (2026-10-22): Ripple, "banks could go live on RippleNet in eight weeks instead of eight months, as the network grew past 200 members"; SingleStore, the $30M+ ARR partner-integration rescue, or 5x engineering velocity and internal cloud spend cut in half.

**Layout:** one page; plain text structure only (no tables, text boxes, or columns); no leftover brackets in a final letter.

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
