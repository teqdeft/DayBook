// My projects' search (a company request): by project or client name, the rule the cards are
// filtered with in the browser, and the server uses for a /projects?q= link.
import { describe, expect, it } from 'vitest';
import {
  MAX_QUERY,
  cleanQuery,
  filterProjects,
  nameMatches,
} from '@/app/(app)/projects/projectFilter';

const projects = [
  { id: 1, name: 'iwilltillimwell' },
  { id: 2, name: 'acme-store' },
  { id: 3, name: 'internal-tool' },
  { id: 4, name: 'acme-app', clientName: 'Acme Health' },
  { id: 5, name: 'Acme Portal' },
  { id: 6, name: 'medlink', clientName: 'Green Valley Clinic' },
];
const names = (list) => list.map((project) => project.name);

describe('cleanQuery', () => {
  it('trims, caps the length and ignores anything that is not text', () => {
    expect(cleanQuery('  acme  ')).toBe('acme');
    expect(cleanQuery('x'.repeat(200))).toHaveLength(MAX_QUERY);
    expect(cleanQuery(undefined)).toBe('');
    expect(cleanQuery(['acme'])).toBe('');
  });
});

describe('nameMatches', () => {
  it('finds any part of the name, whatever the case', () => {
    expect(nameMatches('acme-store', 'STORE')).toBe(true);
    expect(nameMatches('Acme Portal', 'acme p')).toBe(true);
    expect(nameMatches('internal-tool', 'acme')).toBe(false);
  });

  it('finds a dashed name typed with a space or run together', () => {
    expect(nameMatches('acme-app', 'acme app')).toBe(true);
    expect(nameMatches('acme-app', 'acmeapp')).toBe(true);
    expect(nameMatches('Acme Portal', 'acme-portal')).toBe(true);
  });

  it('matches everything for an empty search and nothing for a missing name', () => {
    expect(nameMatches('acme-app', '   ')).toBe(true);
    expect(nameMatches(null, 'acme')).toBe(false);
  });
});

describe('filterProjects', () => {
  it('keeps the matching projects in their order', () => {
    expect(names(filterProjects(projects, 'acme'))).toEqual([
      'acme-store',
      'acme-app',
      'Acme Portal',
    ]);
    expect(names(filterProjects(projects, ' tool '))).toEqual(['internal-tool']);
    expect(filterProjects(projects, 'zzz')).toEqual([]);
  });

  it('also finds a project by its client name', () => {
    expect(names(filterProjects(projects, 'acme health'))).toEqual(['acme-app']);
    expect(names(filterProjects(projects, 'green valley'))).toEqual(['medlink']);
    expect(names(filterProjects(projects, 'clinic'))).toEqual(['medlink']);
  });

  it('gives the same list back for an empty search', () => {
    expect(filterProjects(projects, '')).toBe(projects);
    expect(filterProjects(undefined, 'acme')).toEqual([]);
  });
});
