import { describe, test } from 'vitest';

describe('Phase 2: Core Data (Planned)', () => {
  test.todo('Provider CRUD with demographics and SSN encryption');
  test.todo('Provider specialties many-to-many relationship with taxonomy codes');
  test.todo('State licenses, DEA, board certs, malpractice tracking');
  test.todo('CAQH profile management and attestation status rollup');
});

describe('Phase 3: Documents & Enrollment (Planned)', () => {
  test.todo('MinIO S3 proxied document upload and download');
  test.todo('Document versioning and SHA256 checksum verification');
  test.todo('Payer directory management and required document checklist');
  test.todo('Payer enrollment lifecycle, status workflow, and follow-up logging');
});

describe('Phase 4: Workflow (Planned)', () => {
  test.todo('Task assignment, priorities, and overdue detection');
  test.todo('Polymorphic entity notes');
  test.todo('Primary source verification history');
  test.todo('Audit log viewer UI and export');
});

describe('Phase 5: Automation (Planned)', () => {
  test.todo('BullMQ expiration scan worker');
  test.todo('Missing documents scanner per payer rules');
  test.todo('In-app and email notification dispatch');
});

describe('Phase 6: Polish (Planned)', () => {
  test.todo('Dashboard timeline widgets and enrollment breakdown chart');
  test.todo('Bulk provider import via CSV');
  test.todo('CSP security headers and comprehensive 50-provider seed generator');
});
