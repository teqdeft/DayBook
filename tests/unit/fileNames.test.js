// File names (CONTRACT 27, Names): the cleaned display name, the extension, the rename rule, the
// middle ellipsis and the Content-Disposition of downloads.
import { describe, expect, it } from 'vitest';
import {
  cleanFileName,
  contentDisposition,
  extOf,
  middleEllipsis,
  renamedFileName,
} from '@/modules/projectFiles/names';

const bytes = (text) => new TextEncoder().encode(text).length;

describe('cleanFileName', () => {
  it('normalizes to NFC', () => {
    const decomposed = 'Cafe\u0301 menu.pdf';
    expect(cleanFileName(decomposed)).toBe('Caf\u00e9 menu.pdf');
  });

  it('keeps the last part after / or \\', () => {
    expect(cleanFileName('C:\\fakepath\\a.pdf')).toBe('a.pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('folder/sub\\brief.docx')).toBe('brief.docx');
  });

  it('drops control, bidi and zero-width characters', () => {
    const trick = cleanFileName('March 25 \u202Excod.scr');
    expect(trick).toBe('March 25 xcod.scr');
    expect(trick.endsWith('.scr')).toBe(true);
    expect(cleanFileName('a\u0000b\u001f\u007fc\u009f.txt')).toBe('abc.txt');
    expect(cleanFileName('\u200bre\u200cpo\u200drt\u200e\u200f\ufeff.pdf')).toBe('report.pdf');
    expect(cleanFileName('\u2066x\u2067y\u2068z\u2069\u202a\u202b\u202c\u202d.png')).toBe(
      'xyz.png',
    );
  });

  it('turns the characters Windows refuses into _', () => {
    expect(cleanFileName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
  });

  it('trims spaces and dots at both ends', () => {
    expect(cleanFileName('  notes.txt. . ')).toBe('notes.txt');
    expect(cleanFileName('...hidden name.md')).toBe('hidden name.md');
  });

  it('puts _ before a Windows reserved base name, also with an extension', () => {
    expect(cleanFileName('CON.txt')).toBe('_CON.txt');
    expect(cleanFileName('nul')).toBe('_nul');
    expect(cleanFileName('com1.tar.gz')).toBe('_com1.tar.gz');
    expect(cleanFileName('LPT9.log')).toBe('_LPT9.log');
    expect(cleanFileName('console.txt')).toBe('console.txt');
    expect(cleanFileName('COM10.txt')).toBe('COM10.txt');
  });

  it('cuts 300 characters in the middle, keeping .pdf', () => {
    const name = cleanFileName(`${'a'.repeat(150)}${'b'.repeat(150)}.pdf`);
    expect(Array.from(name).length).toBeLessThanOrEqual(200);
    expect(bytes(name)).toBeLessThanOrEqual(240);
    expect(name.endsWith('b.pdf')).toBe(true);
    expect(name.startsWith('aaa')).toBe(true);
    expect(name).toContain('\u2026');
  });

  it('cuts 300 bytes of emoji in the middle, keeping .pdf', () => {
    const name = cleanFileName(`${'\u{1F600}'.repeat(75)}.pdf`);
    expect(bytes(name)).toBeLessThanOrEqual(240);
    expect(name.endsWith('\u{1F600}.pdf')).toBe(true);
    expect(name).toContain('\u2026');
    // never half an emoji
    expect(name).not.toMatch(/\p{Cs}/u);
  });

  it('a name without an extension is cut in the middle too', () => {
    const name = cleanFileName('x'.repeat(400));
    expect(Array.from(name).length).toBe(200);
    expect(name.indexOf('\u2026')).toBe(140);
  });

  it('empty or only removed characters gives file', () => {
    expect(cleanFileName('')).toBe('file');
    expect(cleanFileName(null)).toBe('file');
    expect(cleanFileName(' . \u202e ')).toBe('file');
  });

  it('drops a lone surrogate', () => {
    expect(cleanFileName('a\ud800b.txt')).toBe('ab.txt');
  });
});

describe('extOf', () => {
  it('takes the part after the last dot, lower case', () => {
    expect(extOf('Brief.PDF')).toBe('pdf');
    expect(extOf('archive.tar.gz')).toBe('gz');
    expect(extOf('photo.JPEG')).toBe('jpeg');
  });

  it('gives an empty extension for none, a leading dot, odd or long ones', () => {
    expect(extOf('README')).toBe('');
    expect(extOf('.htaccess')).toBe('');
    expect(extOf('file.')).toBe('');
    expect(extOf('a.b-c')).toBe('');
    expect(extOf('a.abcdefghijk')).toBe('');
    expect(extOf('a.abcdefghij')).toBe('abcdefghij');
    expect(extOf(undefined)).toBe('');
  });
});

describe('renamedFileName (the rename rule)', () => {
  it('adds the stored extension to the base name', () => {
    expect(renamedFileName('logo final', 'png')).toBe('logo final.png');
  });

  it('never changes the type: b.svg on a PNG becomes b.svg.png', () => {
    expect(renamedFileName('b.svg', 'png')).toBe('b.svg.png');
    expect(extOf(renamedFileName('b.svg', 'png'))).toBe('png');
  });

  it('cleans the whole name and keeps the extension when it is cut', () => {
    const name = renamedFileName(`${'n'.repeat(250)}`, 'docx');
    expect(Array.from(name).length).toBeLessThanOrEqual(200);
    expect(name.endsWith('.docx')).toBe(true);
    expect(renamedFileName('a/b<c>', 'pdf')).toBe('b_c_.pdf');
  });

  it('keeps the extension when the base cleans away', () => {
    expect(renamedFileName('...', 'pdf')).toBe('file.pdf');
  });

  it('a file without an extension keeps none', () => {
    expect(renamedFileName('Makefile copy', '')).toBe('Makefile copy');
  });

  it('never gives a file without an extension one: its last dot becomes _', () => {
    expect(renamedFileName('setup.exe', '')).toBe('setup_exe');
    expect(renamedFileName('page.html', '')).toBe('page_html');
    expect(renamedFileName('archive.tar.gz', '')).toBe('archive.tar_gz');
    expect(renamedFileName('con.exe', '')).toBe('_con_exe');
    expect(renamedFileName('v1.2 notes', '')).toBe('v1.2 notes');
    expect(renamedFileName('.exe', '')).toBe('exe');
    for (const typed of ['setup.exe', 'a.b.c.d', 'report.PDF', `${'n'.repeat(250)}.sh`]) {
      expect(extOf(renamedFileName(typed, ''))).toBe('');
    }
  });
});

describe('middleEllipsis', () => {
  it('keeps short names whole', () => {
    expect(middleEllipsis('brief.pdf', 32)).toBe('brief.pdf');
  });

  it('cuts the middle of the base name and keeps the extension', () => {
    const cut = middleEllipsis('checkout-error-reproduction-steps.pdf', 22);
    expect(cut).toBe('checkout-err\u2026steps.pdf');
    expect(Array.from(cut).length).toBe(22);
  });

  it('cuts a name without an extension in the middle', () => {
    expect(middleEllipsis('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefg\u2026yz');
  });
});

describe('contentDisposition', () => {
  it('sends an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('attachment', 'brief.pdf')).toBe(
      `attachment; filename="brief.pdf"; filename*=UTF-8''brief.pdf`,
    );
    expect(contentDisposition('inline', 'logo.png')).toBe(
      `inline; filename="logo.png"; filename*=UTF-8''logo.png`,
    );
  });

  it('makes " \\ and % safe in the fallback', () => {
    const value = contentDisposition('attachment', 'a"b\\c%d.txt');
    expect(value).toContain('filename="a_b_c_d.txt"');
    expect(value).toContain("filename*=UTF-8''a%22b%5Cc%25d.txt");
  });

  it("encodes ' ( ) * in filename* (RFC 8187)", () => {
    const value = contentDisposition('attachment', "it's (final)*.pdf");
    expect(value).toContain("filename*=UTF-8''it%27s%20%28final%29%2A.pdf");
    expect(value).toContain(`filename="it's (final)*.pdf"`);
  });

  it('drops accents and other non-ASCII characters from the fallback', () => {
    const value = contentDisposition('attachment', 'Résumé – v2.docx');
    expect(value).toContain('filename="Resume  v2.docx"');
    expect(value).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20v2.docx");
  });

  it('an all-Hindi name falls back to download.<ext>', () => {
    const name = 'परियोजना.pdf';
    const value = contentDisposition('attachment', name);
    expect(value).toContain('filename="download.pdf"');
    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
    expect(contentDisposition('attachment', 'परियोजना')).toContain('filename="download"');
  });

  it('never carries a line break or a quote that ends the value early', () => {
    const value = contentDisposition('attachment', 'a\r\nSet-Cookie: x=1".txt');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.match(/"/g)).toHaveLength(2);
  });
});
