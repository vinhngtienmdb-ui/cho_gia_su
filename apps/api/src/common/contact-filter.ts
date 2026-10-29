// Lọc thông tin liên lạc trong chữ học sinh viết ở thảo luận, hỏi đáp, không gian học nhóm (DT-28 phần 28e, YCTD-275; 27i dùng
// lại). An toàn trẻ em: không để học sinh trao số điện thoại, thư điện tử, liên kết ngoài, tài khoản mạng xã hội qua lớp học
// trực tuyến; từ ngữ trong danh sách của trường bị che và gắn cờ cho người xử lý. Hàm thuần, chạy được ở máy chủ và trình duyệt
export type ContactFindingKind = 'phone' | 'email' | 'link' | 'social' | 'word';

export interface ContactFinding {
  kind: ContactFindingKind;
  value: string;
}

export const CONTACT_FINDING_LABELS: Record<ContactFindingKind, string> = {
  phone: 'số điện thoại',
  email: 'thư điện tử',
  link: 'liên kết ngoài',
  social: 'tài khoản mạng xã hội',
  word: 'từ ngữ không phù hợp',
};

const MASK = '***';

// Bỏ dấu tiếng Việt, đổi đ thành d, chữ thường: so từ ngữ không phân biệt dấu, hoa thường
export function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const PATTERNS: Array<{ kind: ContactFindingKind; pattern: RegExp }> = [
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'link', pattern: /\b(?:https?:\/\/|www\.)[^\s,;!?()]+/gi },
  {
    kind: 'social',
    pattern:
      /\b(?:zalo|facebook|fb|messenger|tiktok|instagram|insta|telegram|discord|youtube)\b(?:[\s.:/]*[A-Za-z0-9._@-]+)?/gi,
  },
  { kind: 'social', pattern: /(?<![A-Za-z0-9.])@[A-Za-z0-9_.]{3,30}/g },
  // Số điện thoại Việt Nam: 0 hoặc +84 rồi 9 chữ số, cho phép dấu cách, chấm, gạch giữa các nhóm
  { kind: 'phone', pattern: /(?:\+?84|0)(?:[\s.-]?\d){9}\b/g },
  { kind: 'link', pattern: /\b[a-z0-9-]+\.(?:com|vn|net|org|io|me|app|xyz|info)(?:\/\S*)?\b/gi },
];

// Tìm và che thông tin liên lạc, từ ngữ của trường; trả chữ đã che và các phát hiện (để ghi cờ, gửi hàng chờ khi có từ ngữ)
export function scanContactInfo(
  text: string,
  blockedWords: readonly string[] = [],
): { masked: string; findings: ContactFinding[] } {
  const findings: ContactFinding[] = [];
  let masked = text;
  for (const { kind, pattern } of PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      if (match === MASK) return match;
      findings.push({ kind, value: match });
      return MASK;
    });
  }
  const words = blockedWords.map((word) => foldVietnamese(word.trim())).filter((word) => word.length >= 2);
  if (words.length > 0) {
    // So trên chữ đã bỏ dấu, che đúng vị trí ở chữ gốc (bỏ dấu không đổi số ký tự sau khi chuẩn hóa NFC)
    const source = masked.normalize('NFC');
    const folded = foldVietnamese(source);
    const ranges: Array<[number, number]> = [];
    for (const word of words) {
      let at = folded.indexOf(word);
      while (at >= 0) {
        const before = at === 0 ? ' ' : (folded[at - 1] as string);
        const after = folded[at + word.length] ?? ' ';
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          ranges.push([at, at + word.length]);
        }
        at = folded.indexOf(word, at + word.length);
      }
    }
    ranges.sort((left, right) => right[0] - left[0]);
    let result = source;
    for (const [from, to] of ranges) {
      findings.push({ kind: 'word', value: source.slice(from, to) });
      result = `${result.slice(0, from)}${MASK}${result.slice(to)}`;
    }
    masked = result;
  }
  return { masked, findings };
}
