import https from 'https';
import http from 'http';
import { parse } from 'csv-parse/sync';
import { upsertVoters } from './db.js';

const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1xIoond8as5yz8ZxKP6miLQq8I8oOvi7whQsaBKnWBbg/export?format=csv';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Failed to fetch spreadsheet. HTTP status: ${res.statusCode}`));
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    });

    request.on('error', (err) => reject(err));
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Request to Google Sheet timed out after 15 seconds.'));
    });
  });
}

export async function syncGoogleSheetRoster(customUrl = null) {
  const url = customUrl || process.env.SHEET_URL || DEFAULT_SHEET_URL;
  console.log(`📥 Syncing ARMTI Faculty roster from: ${url}`);

  const csvContent = await fetchUrl(url);
  if (!csvContent || csvContent.trim().length === 0) {
    throw new Error('Google Sheet returned empty data.');
  }

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  if (records.length === 0) {
    throw new Error('No valid records found in the Google Sheet.');
  }

  const staffMap = new Map();

  for (const row of records) {
    const staffIdKey = Object.keys(row).find((k) => k.toLowerCase().includes('staff id')) || 'Staff ID';
    const nameKey = Object.keys(row).find((k) => k.toLowerCase().includes('full name') || k.toLowerCase().includes('name')) || 'FULL NAME (Surname First)';
    const deptKey = Object.keys(row).find((k) => k.toLowerCase().includes('department')) || 'DEPARTMENT';
    const divKey = Object.keys(row).find((k) => k.toLowerCase().includes('division')) || 'DIVISION';
    const centerKey = Object.keys(row).find((k) => k.toLowerCase().includes('center')) || 'TRAINING CENTER';

    const rawStaffId = row[staffIdKey];
    const rawName = row[nameKey];

    if (!rawStaffId || !rawName) continue;

    const staffId = String(rawStaffId).trim();
    let fullName = String(rawName).trim().replace(/\s+/g, ' ');

    if (!staffId || !fullName) continue;

    const department = row[deptKey] ? String(row[deptKey]).trim() : '';
    const division = row[divKey] ? String(row[divKey]).trim() : '';
    const center = row[centerKey] ? String(row[centerKey]).trim() : '';

    staffMap.set(staffId.toLowerCase(), {
      staff_id: staffId,
      full_name: fullName,
      department: department || 'ARMTI Faculty',
      division: division || '',
      training_center: center || ''
    });
  }

  const uniqueFaculty = Array.from(staffMap.values());
  console.log(`📊 Parsed ${records.length} rows -> ${uniqueFaculty.length} unique ARMTI Faculty members.`);

  const syncResult = await upsertVoters(uniqueFaculty);
  return {
    success: true,
    total_rows: records.length,
    unique_faculty: uniqueFaculty.length,
    inserted: syncResult.inserted,
    updated: syncResult.updated,
    roster: uniqueFaculty
  };
}
