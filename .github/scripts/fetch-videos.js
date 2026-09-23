const fs = require('fs');

const TOKEN = process.env.VIMEO_TOKEN;
if (!TOKEN) {
  console.error('VIMEO_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}

async function vimeoGet(url) {
  const res = await fetch(url, { headers: { Authorization: `bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// "회사명 - 영상제목" 형식이면 자동으로 분리, 아니면 company는 빈 값으로 남김
function splitTitle(name) {
  const idx = (name || '').indexOf(' - ');
  if (idx === -1) return { company: '', title: name || '' };
  return { company: name.slice(0, idx).trim(), title: name.slice(idx + 3).trim() };
}

async function main() {
  const me = await vimeoGet('https://api.vimeo.com/me');
  const projects = await vimeoGet(`https://api.vimeo.com${me.uri}/projects?per_page=100&fields=uri,name`);
  const sample = projects.data.find(p => (p.name || '').trim().toLowerCase() === 'sample');
  if (!sample) {
    console.error('sample 폴더를 찾지 못했습니다. 폴더 목록:', projects.data.map(p => p.name));
    process.exit(1);
  }

  const fields = ['uri','name','description','duration','created_time','stats.plays','tags.name','pictures.sizes','player_embed_url','metadata.connections.likes.total','metadata.connections.comments.total'].join(',');
  const videosRes = await vimeoGet(`https://api.vimeo.com${sample.uri}/videos?per_page=100&fields=${fields}`);

  const result = videosRes.data.map(v => {
    const id = v.uri.split('/').pop();
    const bestPic = (v.pictures && v.pictures.sizes || []).slice(-1)[0]?.link || '';
    const mins = Math.floor((v.duration || 0) / 60);
    const secs = String((v.duration || 0) % 60).padStart(2, '0');
    const { company, title } = splitTitle(v.name);
    return {
      id, title, company,
      description: v.description || '',
      date: (v.created_time || '').slice(0, 10).replace(/-/g, '.'),
      views: (v.stats && v.stats.plays) || 0,
      duration: `${mins}:${secs}`,
      tags: (v.tags || []).map(t => `#${t.name}`),
      thumbnail: bestPic,
      embedUrl: v.player_embed_url ? `${v.player_embed_url}&badge=0&autopause=0&player_id=0&app_id=58479` : '',
    };
  });

  fs.writeFileSync('videos.json', JSON.stringify(result, null, 2));
  console.log(`videos.json 저장 완료 (${result.length}개 영상)`);
}

main().catch(err => { console.error(err); process.exit(1); });
