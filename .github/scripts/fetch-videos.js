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

// 모든 페이지를 끝까지 따라가서 data를 합쳐 돌려준다. (per_page 최대 100이라 영상이 100개를 넘어도 안전)
async function vimeoGetAll(url) {
  const all = [];
  let next = url;
  while (next) {
    const page = await vimeoGet(next);
    all.push(...(page.data || []));
    next = page.paging && page.paging.next ? `https://api.vimeo.com${page.paging.next}` : null;
  }
  return all;
}

// [PATCH-9] Vimeo 공식 API의 sort/direction으로 정렬한 순서를 받아 { 영상ID: 등수(0부터) } 로 만든다.
// 프론트(ExpoPortal.js)는 이 값이 모든 영상에 있으면 그대로 쓰고, 없으면 브라우저 정렬로 대체한다.
const SORTS = {
  date: { sort: 'date', direction: 'desc' },         // 최신순
  plays: { sort: 'plays', direction: 'desc' },       // 조회수 높은순
  alphabetical: { sort: 'alphabetical', direction: 'asc' }, // 제목 가나다순
};

async function fetchRanks(baseUri) {
  const ranks = {};
  for (const [key, { sort, direction }] of Object.entries(SORTS)) {
    try {
      const url = `https://api.vimeo.com${baseUri}/videos?per_page=100&fields=uri&sort=${sort}&direction=${direction}`;
      const list = await vimeoGetAll(url);
      const map = {};
      list.forEach((v, i) => { map[v.uri.split('/').pop()] = i; });
      ranks[key] = map;
    } catch (err) {
      // 한 정렬이 실패해도 전체를 멈추지 않는다. 해당 정렬은 프론트가 브라우저 정렬로 대체한다.
      console.warn(`정렬 '${sort}' 순위를 가져오지 못했습니다 (건너뜀):`, String(err).slice(0, 200));
    }
  }
  return ranks;
}

async function main() {
  const me = await vimeoGet('https://api.vimeo.com/me');
  const projects = await vimeoGet(`https://api.vimeo.com${me.uri}/projects?per_page=100&fields=uri,name`);
  const sample = projects.data.find(p => (p.name || '').trim().toLowerCase() === 'sample');
  if (!sample) {
    console.error('sample 폴더를 찾지 못했습니다. 폴더 목록:', projects.data.map(p => p.name));
    process.exit(1);
  }

  const fields = ['uri','name','description','duration','created_time','modified_time','stats.plays','tags.name','pictures.sizes','player_embed_url','metadata.connections.likes.total','metadata.connections.comments.total'].join(',');
  const videos = await vimeoGetAll(`https://api.vimeo.com${sample.uri}/videos?per_page=100&fields=${fields}`);
  const ranks = await fetchRanks(sample.uri);

  const result = videos.map(v => {
    const id = v.uri.split('/').pop();
    const bestPic = (v.pictures && v.pictures.sizes || []).slice(-1)[0]?.link || '';
    const mins = Math.floor((v.duration || 0) / 60);
    const secs = String((v.duration || 0) % 60).padStart(2, '0');
    // 회사명 자동 분리 규칙("회사명 - 영상제목")은 사용하지 않는다.
    // company는 항상 빈 값이고, 화면(ExpoPortal.js)은 비어 있으면 참가사 줄을 그리지 않는다.
    const company = '';
    const title = v.name || '';
    const likes = (v.metadata && v.metadata.connections && v.metadata.connections.likes && v.metadata.connections.likes.total) || 0;
    const comments = (v.metadata && v.metadata.connections && v.metadata.connections.comments && v.metadata.connections.comments.total) || 0;

    // 이 영상의 정렬별 등수. 받아 온 정렬에서 이 영상이 빠져 있으면 그 키는 넣지 않는다.
    const sortRank = {};
    for (const key of Object.keys(ranks)) {
      if (ranks[key][id] !== undefined) sortRank[key] = ranks[key][id];
    }

    return {
      id, title, company,
      description: v.description || '',
      date: (v.created_time || '').slice(0, 10).replace(/-/g, '.'),
      modifiedDate: (v.modified_time || '').slice(0, 10).replace(/-/g, '.'),
      views: (v.stats && v.stats.plays) || 0,
      likes, comments,
      duration: `${mins}:${secs}`,
      tags: (v.tags || []).map(t => `#${t.name}`),
      thumbnail: bestPic,
      embedUrl: v.player_embed_url ? `${v.player_embed_url}&badge=0&autopause=0&player_id=0&app_id=58479` : '',
      sortRank,
    };
  });

  fs.writeFileSync('videos.json', JSON.stringify(result, null, 2));
  console.log(`videos.json 저장 완료 (${result.length}개 영상, 순위 수집: ${Object.keys(ranks).join(', ') || '없음'})`);
}

main().catch(err => { console.error(err); process.exit(1); });
