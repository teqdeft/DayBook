// The top bar search: an Admin's Employee page is for Admins only, so a PM's search leaves Admins
// out, HR (People) opens them in People, and an Admin opens everyone's Employee page.
import { describe, expect, it } from 'vitest';
import { personHref, searchScope } from '@/components/searchScope';

const as = (role) => ({ id: 1, role });
const ceo = { id: 7, name: 'Ravi Kapoor', role: 'admin' };
const vishal = { id: 9, name: 'Vishal Saini', role: 'employee' };

describe('searchScope and personHref', () => {
  it('links Admins to their Employee page for Admins only', () => {
    const admin = searchScope(as('admin'));
    expect(admin).toEqual({ people: 'team', admins: 'team', projects: true });
    expect(personHref(ceo, admin)).toBe('/team/7');
    expect(personHref(vishal, admin)).toBe('/team/9');

    const pm = searchScope(as('pm'));
    expect(pm).toEqual({ people: 'team', admins: null, projects: true });
    expect(personHref(ceo, pm)).toBeNull();
    expect(personHref(vishal, pm)).toBe('/team/9');

    const hr = searchScope(as('hr'));
    expect(hr).toEqual({ people: 'people', admins: 'people', projects: true });
    expect(personHref(ceo, hr)).toBe('/people?q=Ravi%20Kapoor');

    const employee = searchScope(as('employee'));
    expect(employee.people).toBeNull();
    expect(personHref(vishal, employee)).toBeNull();
  });

  it('treats Admins like everyone else when the scope says nothing about them', () => {
    expect(personHref(ceo, { people: 'team' })).toBe('/team/7');
  });
});
