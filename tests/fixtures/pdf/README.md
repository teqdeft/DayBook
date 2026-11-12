# PDF fixtures

Small PDFs for the file reader in the Phases tab (`src/app/(app)/projects/[id]/readDocumentFile.js`,
CONTRACT 22). `tests/unit/readDocumentFile.test.js` reads them with pdf.js. The Word files are in
`tests/fixtures/docx`.

`make-fixtures.mjs` writes every file by hand, with no dependencies. To change one, change the script
and run it from the repo root:

```
node tests/fixtures/pdf/make-fixtures.mjs
```

| File            | What it is                                             | What Daybook should do                                           |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `two-pages.pdf` | Two pages of real text                                 | Reads both, pages joined by a form feed                          |
| `scan.pdf`      | One page holding only a picture, no text layer         | "No readable text. Is it a scan? Paste the key parts as a note." |
| `password.pdf`  | Encrypted with the user password `secret` (40-bit RC4) | "Remove the password or paste the text as a note."               |
| `broken.pdf`    | One sentence of plain text with a `.pdf` name          | "This file isn't a PDF Daybook can read."                        |
| `101-pages.pdf` | 101 one-line pages ("This is page 12.")                | Reads the first 100: "Read the first 100 of 101 pages."          |

`.gitattributes` marks them binary, so Git on Windows can't change their line endings and move the
byte offsets a PDF relies on.
