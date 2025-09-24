export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center space-y-4">
        <h1 className="text-3xl font-bold">Seibro 채권 정보 조회</h1>
        <p className="text-gray-600">좌측 메뉴에서 API를 선택해 조회할 수 있습니다.</p>
        <div>
          <a
            href="/seibro"
            className="inline-flex items-center rounded-md bg-indigo-600 px-6 py-3 text-white font-medium hover:bg-indigo-500"
          >
            시작하기
          </a>
        </div>
      </div>
    </div>
  );
}
