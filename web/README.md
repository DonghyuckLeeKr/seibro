Seibro 채권 정보 조회 UI (Next.js)

## Getting Started

1) 환경변수 설정 (.env.local 생성)

```
SEIBRO_API_KEY=여기에_API_KEY
SEIBRO_BASE_URL=https://seibro.or.kr/OpenPlatform/callOpenAPI.jsp
```

2) 개발 서버 실행:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열고, 홈 → "시작하기"로 이동하여 `/seibro` 페이지에서 8개 API를 조회하세요.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

본 프로젝트는 [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)를 사용해 [Geist](https://vercel.com/font) 폰트를 로드합니다.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
