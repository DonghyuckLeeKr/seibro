export type FieldType = "text" | "date" | "select";

export type ApiField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  sample?: string;
  description?: string;
  options?: { value: string; label: string }[];
};

export type ApiDefinition = {
  id: string;
  title: string;
  description: string;
  fields: ApiField[];
  // custom validation for complex requirements (e.g., at least one of two fields)
  validate?: (params: Record<string, string>) => string | null;
};

export const apiList: ApiDefinition[] = [
  {
    id: "getBondIssuInfo",
    title: "채권 발행내역",
    description: "발행일별/발행회사별 발행종목 조회",
    fields: [
      {
        name: "ISSU_DT",
        label: "발행일자 (YYYYMMDD)",
        type: "date",
        required: false,
        placeholder: "예: 20180803",
        sample: "20180803",
      },
      {
        name: "ISSUCO_CUSTNO",
        label: "발행회사고객번호",
        type: "text",
        required: false,
        placeholder: "예: 29998",
        sample: "29998",
      },
    ],
    validate: (p) => {
      if (!p.ISSU_DT && !p.ISSUCO_CUSTNO) {
        return "발행일자 또는 발행회사고객번호 중 최소 1개는 입력해야 합니다.";
      }
      return null;
    },
  },
  {
    id: "getBondStatInfo",
    title: "채권 종목 정보",
    description: "채권 종목별 상세 정보",
    fields: [
      { name: "ISIN", label: "종목코드(ISIN)", type: "text", required: true, placeholder: "예: KR6268761881" },
    ],
  },
  {
    id: "getIntPayInfo",
    title: "이자지급 정보",
    description: "채권 종목별 이자지급 정보",
    fields: [
      { name: "ISIN", label: "종목코드(ISIN)", type: "text", required: true, placeholder: "예: KR6294891884" },
    ],
  },
  {
    id: "getBondOptionXrcInfo",
    title: "조기상환 정보",
    description: "콜/풋 옵션 행사에 따른 조기상환 내역",
    fields: [
      { name: "ISIN", label: "종목코드(ISIN)", type: "text", required: false, placeholder: "예: KR6225693573" },
      { name: "ERLY_RED_DT", label: "조기상환일(YYYYMMDD)", type: "date", required: false, placeholder: "예: 20180824" },
    ],
    validate: (p) => {
      if (!p.ISIN && !p.ERLY_RED_DT) {
        return "ISIN 또는 조기상환일 중 최소 1개는 입력해야 합니다.";
      }
      return null;
    },
  },
  {
    id: "getShortmIssuInfo",
    title: "단기금융증권 발행내역",
    description: "발행일별 발행종목 조회",
    fields: [
      { name: "ISSU_DT", label: "발행일자(YYYYMMDD)", type: "date", required: true, placeholder: "예: 20180801" },
      {
        name: "SECN_TPCD",
        label: "종목구분코드",
        type: "select",
        required: true,
        options: [
          { value: "12", label: "12 - 어음" },
          { value: "13", label: "13 - CD" },
          { value: "14", label: "14 - 전자단기사채" },
        ],
      },
    ],
  },
  {
    id: "getCDInfo",
    title: "CD 종목 정보",
    description: "CD 종목별 상세 정보",
    fields: [
      { name: "ISIN", label: "종목코드(ISIN)", type: "text", required: true, placeholder: "예: KRZE0070187S" },
    ],
  },
  {
    id: "getCPInfo",
    title: "CP 종목 정보",
    description: "CP 종목별 상세 정보",
    fields: [
      { name: "ISIN", label: "종목코드(ISIN)", type: "text", required: true, placeholder: "예: KRZF30300A87" },
    ],
  },
  {
    id: "getESTBInfo",
    title: "전자단기사채 종목 정보",
    description: "전자단기사채 종목별 상세 정보",
    fields: [
      { name: "ISIN", label: "종목코드(ISIN)", type: "text", required: true, placeholder: "예: KRZS24449010" },
    ],
  },
];

export function toParamsString(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && String(v).trim() !== "");
  return entries.map(([k, v]) => `${k}:${String(v).trim()}`).join(",");
}

export function isYYYYMMDD(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export const batchApiIds = [
  "getBondStatInfo",
  "getIntPayInfo",
  "getCDInfo",
  "getCPInfo",
  "getESTBInfo",
] as const;

export type BatchApiId = typeof batchApiIds[number];


