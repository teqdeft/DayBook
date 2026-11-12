# Word fixtures

Small Word files for the file reader in the Phases tab (`src/app/(app)/projects/[id]/readDocx.js`,
`docxText.js` and `readDocumentFile.js`, CONTRACT 22). `tests/unit/readDocx.test.js` and
`tests/unit/readDocumentFile.test.js` read them, and `tests/e2e/project-plan.spec.js` can pick
`normal.docx` in a real browser.

`make-fixtures.mjs` writes every file by hand, with nothing but `node:zlib`: `zip.mjs` is a tiny zip
writer and `word.mjs` holds the parts of a .docx as Word writes them. To change a file, change the
script and run it from the repo root:

```
node tests/fixtures/docx/make-fixtures.mjs
```

| File                   | What it is                                                                                                                                                                                                                                                | What Daybook should do                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `normal.docx`          | Paragraphs, a run split in three, a tab (and a tab stop that isn't one), a line break and a carriage return, a deleted and an inserted run, a field, a table, Hindi and Punjabi, `&amp;` and `&#x20B9;`, a page break; plus a header, footer and comments | Reads exactly `NORMAL_TEXT` in `make-fixtures.mjs`, none of the other parts |
| `stored.docx`          | Every entry stored (zip method 0), not deflated                                                                                                                                                                                                           | Reads it without inflating                                                  |
| `data-descriptor.docx` | Every entry deflated with its sizes in a data descriptor after the data, and zeros in the local header                                                                                                                                                    | Reads it, with the sizes from the central directory                         |
| `no-text.docx`         | Empty paragraphs, a page break, an empty table and only deleted words                                                                                                                                                                                     | "This file has no text."                                                    |
| `password.docx`        | The start of an OLE file (`D0 CF 11 E0`) with `EncryptionInfo` and `EncryptedPackage` streams, as Word saves a .docx with a password                                                                                                                      | "Remove the password or paste the text as a note."                          |
| `old-word.doc`         | The start of an OLE file with a `WordDocument` stream, as Word 97 to 2003 saves a .doc                                                                                                                                                                    | "This is an old Word file. Save it as .docx or PDF first."                  |
| `broken.docx`          | The first half of `normal.docx`, so it has no central directory                                                                                                                                                                                           | "This file isn't a Word file Daybook can read."                             |
| `no-document.docx`     | A real zip with every part of `normal.docx` but `word/document.xml`                                                                                                                                                                                       | "This file isn't a Word file Daybook can read."                             |

The two OLE files are only their first 1,024 bytes (the header and the names of their streams): all
Daybook looks at is the signature. Tests build the other cases in memory with `zip.mjs` (encrypted
entries, zip64, unknown methods, damaged deflate data, a document.xml over the limit).

`.gitattributes` marks them binary, so Git on Windows can't change their line endings and move the
byte offsets a zip relies on.
