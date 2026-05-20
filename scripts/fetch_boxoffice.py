#!/usr/bin/env python3
"""무비차트에서 실시간 예매 순위 TOP 10 수집"""
import json, re, urllib.request

URL = 'https://m.moviechart.co.kr/rank/realtime/index/image'

def fetch():
    req = urllib.request.Request(URL, headers={
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'
    })
    html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8')

    # 제목: <h3><a href="...">군체</a></h3>
    titles = re.findall(r'<h3><a href="[^"]*">([^<]+)</a></h3>', html)
    # 예매율: <li class="ticketing">예매율 <span>52.30%</span></li>
    rates = re.findall(r'class="ticketing">예매율\s*<span>([\d.]+%)</span>', html)
    # 개봉일: <li class="movie-launch">개봉일 2026.05.21</li>
    dates = re.findall(r'class="movie-launch">개봉일\s*([\d.]+)</li>', html)
    # 포스터: <img src="..." class="poster" 등
    posters = re.findall(r'<img[^>]+src="(https://[^"]*moviechart[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"', html, re.IGNORECASE)

    movies = []
    for i in range(min(len(titles), 10)):
        # 제목에 줄거리가 섞인 경우 ':' 또는 30자 이후 자르기
        raw_title = titles[i].strip()
        if len(raw_title) > 40:
            cut = raw_title.find(' : ')
            if cut > 0 and cut < 30:
                raw_title = raw_title[:cut]
            else:
                raw_title = raw_title[:30].rstrip()
        movie = {
            'rank': i + 1,
            'title': raw_title,
            'rate': rates[i] if i < len(rates) else '',
            'date': dates[i] if i < len(dates) else '',
        }
        if i < len(posters):
            movie['poster'] = posters[i]
        movies.append(movie)

    return movies

def main():
    movies = fetch()
    if not movies:
        print('❌ 수집 실패')
        return

    from datetime import datetime, timezone, timedelta
    kst = timezone(timedelta(hours=9))
    now = datetime.now(kst).strftime('%Y-%m-%d %H:%M')

    data = {
        'updated': now,
        'source': 'moviechart.co.kr',
        'movies': movies,
    }

    with open('data/boxoffice.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f'✅ 예매 순위 {len(movies)}건 저장 ({now})')
    for m in movies:
        print(f'  {m["rank"]}. {m["title"]} {m.get("rate","")} ({m.get("date","")})')

if __name__ == '__main__':
    main()
