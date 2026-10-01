// People on the design canvas plus enough colleagues to reach the canvas counts.
//
// Counts: the dashboards (05, 09, 11) show 26 tracked people; People (10) and Roles (13) say
// 26 active. Neither the CEO nor the three project managers are tracked (company rule, made after
// the canvas: PMs don't check in or write reports), so both can't hold. We follow the dashboards:
// 30 active people (26 tracked + the CEO + 3 PMs), so Development has 16 people and there are
// 23 employees (the canvas shows 12 and 19). Nikhil, Ritu and Yash are not on the canvas; they
// take over the hours the PMs logged on the canvas.
//
// `key` is how the rest of the demo data refers to a person. `reportsTo` is another key.
// `wfhEvery`: roughly one day in N is WFH in the generated history (0 = never).
// `projects`: projects the person logs in the generated history; the first is their main one.
// `tracksAttendance` follows roleTracksAttendance(), so a PM is never tracked.
import { roleTracksAttendance } from '@/lib/permissions';

/** The CEO comes from db/seeds/04_admin.js (SEED_ADMIN_EMAIL); the demo only fills in details. */
export const CEO = { key: 'ceo', email: 'ceo@company.com', joinedOn: '2019-06-03' };

export const PEOPLE = [
  // The eight people on Attendance (09), in the canvas order.
  person('vishal', 'Vishal Saini', 'Frontend developer', 'Development', 'pm', '2024-03-12', {
    projects: ['internal', 'iwill', 'studio', 'portal', 'landing'],
  }),
  person('priya', 'Priya Sharma', 'SEO executive', 'SEO', 'pm', '2023-07-17', {
    projects: ['seo', 'urbanfit', 'studio'],
    wfhEvery: 9,
  }),
  person('rohit', 'Rohit Verma', 'Full stack developer', 'Development', 'pm', '2022-11-07', {
    projects: ['internal', 'app', 'nova'],
  }),
  person('ankit', 'Ankit Rana', 'SEO executive', 'SEO', 'pm', '2024-09-02', {
    projects: ['seo', 'portal', 'urbanfit'],
  }),
  person('aman', 'Aman Singh', 'Bidder', 'Sales', 'pm', '2023-02-13', { projects: ['proposals'] }),
  person('simran', 'Simran Kaur', 'Full stack developer', 'Development', 'pm', '2023-05-22', {
    projects: ['store', 'iwill', 'internal'],
    wfhEvery: 7,
  }),
  person('karan', 'Karan Mehta', 'Frontend developer', 'Development', 'pm2', '2024-01-08', {
    projects: ['greenleaf', 'sunrise', 'app'],
  }),
  person('deepak', 'Deepak Joshi', 'SEO executive', 'SEO', 'pm', '2022-08-01', {
    projects: ['seo', 'urbanfit'],
  }),

  // Managers and HR. The PMs don't check in or log hours.
  person('pm', '[PM name]', 'Project manager', 'Delivery', 'ceo', '2021-04-05', {
    email: 'pm@company.com',
    role: 'pm',
  }),
  person('pm2', '[PM 2 name]', 'Project manager', 'Delivery', 'ceo', '2022-01-10', {
    email: 'pm2@company.com',
    role: 'pm',
  }),
  person('neha', 'Neha Gupta', 'HR executive', 'HR', 'anjali', '2023-09-18', {
    role: 'hr',
    projects: ['hiring'],
  }),
  person('sanjay', 'Sanjay Kulkarni', 'Delivery manager', 'Delivery', 'ceo', '2021-10-11', {
    role: 'pm',
  }),
  person('anjali', 'Anjali Bose', 'HR manager', 'HR', 'meera', '2021-07-19', {
    role: 'hr',
    projects: ['hiring', 'kb'],
  }),
  person('meera', 'Meera Pillai', 'Head of operations', 'Leadership', 'ceo', '2020-02-03', {
    role: 'admin',
    projects: ['proposals', 'kb'],
  }),

  // Development.
  person('arjun', 'Arjun Nair', 'Backend developer', 'Development', 'sanjay', '2022-06-13', {
    projects: ['internal', 'nova'],
  }),
  person('pooja', 'Pooja Iyer', 'Frontend developer', 'Development', 'pm2', '2023-03-06', {
    projects: ['store', 'greenleaf'],
    wfhEvery: 8,
  }),
  person('sahil', 'Sahil Khan', 'Full stack developer', 'Development', 'pm', '2024-05-20', {
    projects: ['store', 'internal'],
  }),
  person('rahul', 'Rahul Jain', 'Backend developer', 'Development', 'sanjay', '2022-02-21', {
    projects: ['nova', 'internal'],
    wfhEvery: 10,
  }),
  person('sneha', 'Sneha Patil', 'QA engineer', 'Development', 'sanjay', '2023-11-13', {
    projects: ['kb', 'nova', 'internal'],
  }),
  person('manish', 'Manish Tiwari', 'Full stack developer', 'Development', 'sanjay', '2021-12-06', {
    projects: ['internal', 'nova', 'store'],
  }),
  person('kavya', 'Kavya Reddy', 'UI designer', 'Development', 'pm', '2024-02-05', {
    projects: ['greenleaf', 'iwill', 'store'],
    wfhEvery: 9,
  }),
  person('harsh', 'Harsh Vardhan', 'Mobile developer', 'Development', 'pm2', '2023-08-28', {
    projects: ['sunrise', 'kb', 'app'],
    wfhEvery: 11,
  }),
  person('divya', 'Divya Menon', 'QA engineer', 'Development', 'pm2', '2024-06-17', {
    projects: ['store', 'greenleaf', 'kb'],
    wfhEvery: 6,
  }),

  // SEO and Sales.
  person('meena', 'Meena Das', 'Content writer', 'SEO', 'pm', '2023-04-10', {
    projects: ['urbanfit', 'seo', 'iwill'],
    wfhEvery: 4,
  }),
  person('varun', 'Varun Chopra', 'SEO analyst', 'SEO', 'sanjay', '2024-07-01', {
    projects: ['urbanfit', 'seo'],
  }),
  person(
    'farhan',
    'Farhan Qureshi',
    'Business development executive',
    'Sales',
    'pm',
    '2022-09-12',
    {
      projects: ['proposals'],
    },
  ),

  // Not on the canvas: with the PMs untracked they keep the dashboards at 26 tracked people.
  person('nikhil', 'Nikhil Arora', 'Full stack developer', 'Development', 'pm2', '2025-01-13', {
    projects: ['internal', 'app', 'nova'],
  }),
  person('ritu', 'Ritu Malhotra', 'QA engineer', 'Development', 'pm', '2025-03-03', {
    projects: ['store', 'iwill', 'kb'],
    wfhEvery: 9,
  }),
  person('yash', 'Yash Thakur', 'Frontend developer', 'Development', 'pm', '2024-11-18', {
    projects: ['store', 'iwill', 'greenleaf'],
  }),
];

/** Deactivated people (People shows "2 deactivated"). They left before the demo history starts. */
export const DEACTIVATED = [
  person('tarun', 'Tarun Bansal', 'Frontend developer', 'Development', 'pm', '2022-03-14', {
    status: 'deactivated',
    deactivatedOn: '2026-06-30',
  }),
  person('gaurav', 'Gaurav Saxena', 'SEO executive', 'SEO', 'pm', '2023-01-16', {
    status: 'deactivated',
    deactivatedOn: '2026-05-29',
  }),
];

function person(key, name, designation, department, reportsTo, joinedOn, extra = {}) {
  const row = {
    key,
    name,
    email: `${key}@company.com`,
    designation,
    department,
    role: 'employee',
    reportsTo,
    joinedOn,
    tracksAttendance: true,
    status: 'active',
    wfhEvery: 0,
    projects: [],
    ...extra,
  };
  return { ...row, tracksAttendance: roleTracksAttendance(row.role, row.tracksAttendance) };
}
