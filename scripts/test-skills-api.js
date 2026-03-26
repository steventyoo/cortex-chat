const { SignJWT } = require('jose');

const BASE = 'http://localhost:3001';
const SESSION_SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

async function makeToken() {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  return new SignJWT({
    userId: 'user_ishaan',
    orgId: 'org_owp_001',
    email: 'ishaan.shrivastava@gmail.com',
    name: 'Ishaan Shrivastava',
    role: 'admin',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

async function main() {
  const token = await makeToken();
  const cookie = `cortex-session=${token}`;
  const authHeaders = { Cookie: cookie };

  // 1. GET /api/skills — list all skills
  console.log('=== Test 1: GET /api/skills ===');
  const listRes = await fetch(`${BASE}/api/skills`, { headers: authHeaders });
  const listBody = await listRes.json();
  console.log('Status:', listRes.status);
  console.log('Skills count:', listBody.skills?.length);
  for (const s of (listBody.skills || [])) {
    const fieldCount = s.field_definitions?.length || 0;
    console.log(`  - ${s.skill_id} (${s.display_name}) — ${fieldCount} fields, v${s.version}`);
  }
  console.log();

  // 2. GET /api/skills/change_order — single skill
  console.log('=== Test 2: GET /api/skills/change_order ===');
  const singleRes = await fetch(`${BASE}/api/skills/change_order`, { headers: authHeaders });
  const singleBody = await singleRes.json();
  console.log('Status:', singleRes.status);
  if (singleBody.skill) {
    console.log('Skill ID:', singleBody.skill.skill_id);
    console.log('Display Name:', singleBody.skill.display_name);
    console.log('Version:', singleBody.skill.version);
    console.log('Fields:');
    for (const f of (singleBody.skill.field_definitions || [])) {
      console.log(`  - ${f.name} (${f.type}, tier ${f.tier}, required: ${f.required})`);
    }
  } else {
    console.log('Response:', JSON.stringify(singleBody, null, 2));
  }
  console.log();

  // 3. PATCH /api/skills/change_order — add "Test Field"
  console.log('=== Test 3: PATCH add "Test Field" ===');
  const patchRes = await fetch(`${BASE}/api/skills/change_order`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      addFields: [{ name: 'Test Field', type: 'string', tier: 2, required: false, description: 'test' }],
    }),
  });
  const patchBody = await patchRes.json();
  console.log('Status:', patchRes.status);
  if (patchBody.skill) {
    console.log('New version:', patchBody.skill.version);
    const testField = patchBody.skill.field_definitions?.find(f => f.name === 'Test Field');
    console.log('Test Field added:', !!testField);
    if (testField) console.log('  Details:', JSON.stringify(testField));
    console.log('Total fields:', patchBody.skill.field_definitions?.length);
  } else {
    console.log('Response:', JSON.stringify(patchBody, null, 2));
  }
  console.log();

  // 4. PATCH /api/skills/change_order — remove "Test Field" (cleanup)
  console.log('=== Test 4: PATCH remove "Test Field" ===');
  const removeRes = await fetch(`${BASE}/api/skills/change_order`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      removeFields: ['Test Field'],
    }),
  });
  const removeBody = await removeRes.json();
  console.log('Status:', removeRes.status);
  if (removeBody.skill) {
    console.log('Version after removal:', removeBody.skill.version);
    const gone = !removeBody.skill.field_definitions?.find(f => f.name === 'Test Field');
    console.log('Test Field removed:', gone);
    console.log('Total fields:', removeBody.skill.field_definitions?.length);
  } else {
    console.log('Response:', JSON.stringify(removeBody, null, 2));
  }

  console.log('\n=== All Skills API tests complete ===');
}

main().catch(console.error);
