// Clients and projects from the canvas (04, 05, 07, 11). Colours were sampled from the labels.
//
// Totals on Projects (07): 12 active, 2 on hold, 18 completed. Vishal (04) is a member of
// 6 active or on-hold projects and 9 completed ones. Member order follows the avatar order on the
// canvas (members are added in this order). Nikhil, Ritu and Yash (not on the canvas) are added
// last, only to projects whose rows the canvas doesn't show.
//
// `minOffset` / `maxOffset`: the generated history may log hours to the project only on days whose
// working-day offset (0 = anchor day, growing into the past) is in this range. acme-app was
// created from Rohit's request at offset 6 (22 Sep); the on-hold projects and acme-landing only had
// work about a month ago.

export const CLIENTS = [
  { name: '[Client name]' },
  { name: 'Acme Retail' },
  { name: 'Acme Health' },
  { name: 'Greenleaf Foods' },
  { name: 'Nova Labs' },
  { name: 'UrbanFit' },
  { name: 'Sunrise Hotels' },
  { name: 'Brightside Media' },
  { name: 'MedLink' },
];

// The urgent note: 01 shows "Client needs the homepage content changes live today." while 05, 07
// and 11 show "Homepage content live today". One note is stored; we use the short one because
// three artboards show it and it fits the small cards and the table row without wrapping.
export const URGENT_NOTES = {
  iwill: 'Homepage content live today',
  store: 'Checkout fix before client demo',
};

export const PROJECTS = [
  project('iwill', 'iwilltillimwell', '[Client name]', 'pm', 'orange', ['vishal', 'simran'], {
    urgent: { note: URGENT_NOTES.iwill, clock: '11:05', by: 'pm', midday: true },
  }),
  project('internal', 'internal-tool', 'Internal', 'pm', 'blue', ['vishal', 'rohit', 'simran']),
  project('store', 'acme-store', 'Acme Retail', 'pm', 'green', ['simran', 'vishal'], {
    // Marked at 2:40 PM. The midday state (01, at 3:10 PM) shows a single urgent card, so the
    // --midday data leaves this one unmarked.
    urgent: { note: URGENT_NOTES.store, clock: '14:40', by: 'pm', midday: false },
  }),
  project('seo', 'acme-seo', 'Acme Retail', 'pm', 'violet', [
    'priya',
    'ankit',
    'deepak',
    'meena',
    'varun',
  ]),
  project('proposals', 'Proposals', 'Internal', 'pm', 'teal', ['aman', 'farhan']),
  project('app', 'acme-app', 'Acme Health', 'pm2', 'pink', ['rohit', 'karan', 'vishal'], {
    createdOffset: 6,
    createdClock: '16:15',
    maxOffset: 5,
  }),
  // 07 shows Neha Gupta (HR) as the PM of Hiring. We keep the canvas; see the seed notes.
  project('hiring', 'Hiring', 'Internal', 'neha', 'pink', ['neha', 'anjali']),
  project('studio', 'studio-site', 'Internal', 'pm', 'violet', ['vishal', 'priya']),
  project('greenleaf', 'greenleaf-shop', 'Greenleaf Foods', 'pm2', 'green', [
    'pooja',
    'kavya',
    'divya',
    'karan',
    'yash',
  ]),
  project('nova', 'nova-dashboard', 'Nova Labs', 'sanjay', 'blue', [
    'arjun',
    'rahul',
    'manish',
    'nikhil',
  ]),
  project('urbanfit', 'urbanfit-seo', 'UrbanFit', 'sanjay', 'orange', ['varun', 'meena', 'deepak']),
  project('kb', 'knowledge-base', 'Internal', 'sanjay', 'teal', [
    'sneha',
    'divya',
    'harsh',
    'meera',
    'ritu',
  ]),
  project('portal', 'acme-portal', 'Acme Retail', 'pm2', 'teal', ['vishal', 'ankit'], {
    status: 'on_hold',
    minOffset: 22,
  }),
  project('sunrise', 'sunrise-crm', 'Sunrise Hotels', 'pm2', 'orange', ['karan', 'harsh'], {
    status: 'on_hold',
    minOffset: 22,
  }),
];

// 18 completed projects; Vishal is a member of the first nine. The number is the working-day offset
// of the completion day. Only acme-landing (completed 4 Sep) has hours inside the demo history.
export const COMPLETED_PROJECTS = [
  done('landing', 'acme-landing', 'Acme Retail', 'pm', 'green', ['vishal', 'kavya'], 18, true),
  done('brightside', 'brightside-web', 'Brightside Media', 'pm', 'blue', ['vishal', 'pooja'], 60),
  done('intranet', 'old-intranet', 'Internal', 'sanjay', 'teal', ['vishal', 'arjun'], 75),
  done('novaweb', 'nova-website', 'Nova Labs', 'sanjay', 'blue', ['vishal', 'rahul'], 90),
  done('urbanland', 'urbanfit-landing', 'UrbanFit', 'pm2', 'orange', ['vishal', 'kavya'], 105),
  done('booking', 'sunrise-booking', 'Sunrise Hotels', 'pm2', 'pink', ['vishal', 'harsh'], 120),
  done('brand', 'brand-refresh', 'Internal', 'pm', 'violet', ['vishal', 'kavya'], 135),
  done('analytics', 'acme-analytics', 'Acme Retail', 'pm', 'blue', ['vishal', 'simran'], 150),
  done('healthsite', 'acme-health-site', 'Acme Health', 'pm2', 'pink', ['vishal', 'rohit'], 165),
  done('greenseo', 'greenleaf-seo', 'Greenleaf Foods', 'pm', 'violet', ['priya', 'meena'], 70),
  done('handbook', 'company-handbook', 'Internal', 'meera', 'teal', ['anjali', 'neha'], 85),
  done('greenapp', 'greenleaf-app', 'Greenleaf Foods', 'pm2', 'green', ['karan', 'divya'], 100),
  done('novaseo', 'nova-seo', 'Nova Labs', 'sanjay', 'violet', ['varun', 'deepak'], 115),
  done('urbancrm', 'urbanfit-crm', 'UrbanFit', 'sanjay', 'orange', ['manish', 'sahil'], 130),
  done('sunseo', 'sunrise-seo', 'Sunrise Hotels', 'pm', 'violet', ['ankit', 'priya'], 145),
  done('hrportal', 'hr-portal', 'Internal', 'sanjay', 'teal', ['sneha', 'rohit'], 160),
  done('brightseo', 'brightside-seo', 'Brightside Media', 'pm', 'violet', ['meena', 'varun'], 175),
  done('medlink', 'medlink-app', 'MedLink', 'pm2', 'blue', ['harsh', 'karan'], 190),
];

// Task titles the generated history picks from, per project.
export const TASK_BANK = {
  internal: [
    'Leave balance API',
    'Team page filters',
    'Audit log view',
    'Notification settings',
    'Search API',
    'Session timeout fix',
    'Dashboard widgets',
    'Report export',
    'Permissions check',
    'Timesheet API',
    'Holiday calendar',
    'Bug fixes from QA',
    'Unit tests for reports',
    'Profile page',
    'Error pages',
  ],
  iwill: [
    'Homepage content review',
    'Page speed fixes',
    'Newsletter signup form',
    'Pricing page',
    'FAQ section',
    'Gallery page',
    'Header redesign',
    'Cookie banner',
    'SEO meta tags',
  ],
  store: [
    'Order summary styles',
    'Product filters',
    'Wishlist button',
    'Coupon field',
    'Shipping options',
    'Product image zoom',
    'Order emails',
    'Inventory sync fix',
    'Checkout QA',
    'Search results page',
  ],
  seo: [
    'Keyword research',
    'On-page audit',
    'Meta descriptions',
    'Backlink outreach',
    'Competitor analysis',
    'Technical SEO fixes',
    'Monthly ranking report',
    'Category page copy',
    'Schema markup',
    'Internal linking plan',
  ],
  proposals: [
    'Bid for retail app',
    'Proposal for hotel website',
    'Upwork bids',
    'Estimate for CRM project',
    'Client call notes',
    'Case study for proposal',
    'Pricing sheet update',
    'Follow-up emails',
  ],
  app: [
    'App login screens',
    'Appointment booking API',
    'Doctor list screen',
    'Push notifications',
    'Patient profile',
    'App store build',
  ],
  hiring: [
    'Screen frontend CVs',
    'Interview scheduling',
    'Offer letters',
    'Onboarding checklist',
    'Job post for QA',
    'Reference checks',
    'Interview feedback',
  ],
  studio: ['Studio homepage copy', 'Portfolio page', 'Studio contact form', 'Team page photos'],
  greenleaf: [
    'Product catalogue',
    'Checkout flow',
    'Recipe pages',
    'Delivery slots',
    'Promo banners',
    'Order tracking page',
    'Store locator',
    'QA for checkout',
  ],
  nova: [
    'Charts API',
    'Usage report page',
    'Data import job',
    'Alert rules',
    'Dashboard filters',
    'CSV export',
    'User invites',
    'Performance fixes',
  ],
  urbanfit: [
    'Keyword mapping',
    'Blog calendar',
    'Gym page copy',
    'Local SEO listings',
    'Site audit',
    'Link building',
    'Ranking report',
  ],
  kb: [
    'Test case library',
    'Coding guidelines',
    'QA checklist',
    'Release notes template',
    'Onboarding docs',
    'API docs cleanup',
  ],
  portal: ['Portal login', 'Invoice list', 'Account settings', 'Support tickets page'],
  sunrise: ['Guest list screen', 'Booking sync', 'CRM reports', 'Room status API'],
  landing: ['Landing page build', 'Hero animation', 'Signup form', 'Launch QA'],
};

function project(key, name, client, pm, color, members, extra = {}) {
  return {
    key,
    name,
    client,
    pm,
    color,
    members,
    status: 'active',
    createdOffset: null,
    createdClock: '10:00',
    urgent: null,
    minOffset: 0,
    maxOffset: Infinity,
    ...extra,
  };
}

function done(key, name, client, pm, color, members, completedOffset, hasHistory = false) {
  return project(key, name, client, pm, color, members, {
    status: 'completed',
    completedOffset,
    minOffset: hasHistory ? completedOffset + 1 : Infinity,
  });
}
