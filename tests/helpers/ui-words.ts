// 画面で使わない言葉（docs/design/ui-words.md の表と同じ ID）。tests/ui-wording.test.ts が画面の文から探す。
// 表に行を足したら、ここにも同じ ID で足す（テストが 2 つの ID がそろっているかを確かめる）

export type UiWordRule = {
  id: string;
  // 見つける形。文 1 つ（画面の文のまとまり）に当てる
  pattern: RegExp;
};

export const UI_WORD_RULES: UiWordRule[] = [
  { id: "ana", pattern: /穴/ },
  // 助詞のあとの「直す」だけ。「つなぎ直す」「入れ直す」のような、やり直しの意味は使ってよい
  { id: "naosu", pattern: /(^|[をでがはもとへ、。「」\s（])直[すしせさ]/ },
  { id: "okyaku", pattern: /お客さん/ },
  { id: "renkei", pattern: /連携|接続/ },
  { id: "zumi", pattern: /公開済み|投稿済み|送った投稿/ },
  { id: "jidou", pattern: /自動の投稿/ },
  // 最初の画面の名前は「ホーム」（2026-11-21 オーナーの決定）。画面の名前でない「概要」は引っかけない
  { id: "home", pattern: /概要(?:へ|に戻る|の「|の帯|の画面|で見られ|から開|に「)|^Overview$/ },
  // 手で投稿する・手で出す（2026-11-21 オーナーの指示。手動で投稿する）。「手で記録」「手で入力」は対象外
  { id: "shudou", pattern: /手で(?:は)?(?:投稿|出)|・手で(?![一-龯ぁ-んァ-ン])/ },
  // 作る側の「1 回分の投稿」の意味の「回」。回数（1 回・毎回・2 回まで・回数）は使ってよい
  {
    id: "kai",
    pattern:
      /(その|この|次の|最初の|前の|新しい|これからの|これまでの|ほかの|どの|ない|った|した|れた|いた|けた|せた)回(?![数目転])|回ごと|回分|回の記録|まだ回|[1１] 回分/,
  },
  { id: "mihon1", pattern: /見本の ?[1１] ?回/ },
  // 画像を「右に 90° 回す」・「言い回し」・「1 回しか」は使ってよい
  { id: "mawasu", pattern: /(?<!° ?|言い)回(す|し(?!か)|さ)/ },
  { id: "zairyo", pattern: /材料/ },
  { id: "bamen", pattern: /場面/ },
  { id: "machi", pattern: /確かめ待ち/ },
  { id: "tashikame", pattern: /確かめ([でがをのも]|は(?!じ)|$|[。）」])/ },
  { id: "dankai", pattern: /段階|段取り/ },
  { id: "shurui", pattern: /^種類(（[^）]*）)?$/ },
  { id: "tsukaimichi", pattern: /使い道/ },
  { id: "hashira", pattern: /柱/ },
  { id: "katanobun", pattern: /型の文/ },
  { id: "umetarei", pattern: /埋めた例/ },
  { id: "haishinsaki", pattern: /配信先/ },
  { id: "azukaru", pattern: /預か/ },
  { id: "hikkakaru", pattern: /引っかか/ },
  { id: "ikisaki", pattern: /行き先/ },
  { id: "kumitate", pattern: /組み立て/ },
  // 終わった意味の「済み」「済んだ」。「〜しなくて済む」・「送信済み」など（zumi）は除く
  { id: "sumi", pattern: /済みました|済んだ|済んで|済みにし|済みにする|^済み(\s|$)/ },
  { id: "sekkei", pattern: /設計/ },
  { id: "kisoku", pattern: /規則/ },
  { id: "ugoku", pattern: /動いて(いる|います)/ },
  // 「秘密鍵」（.p8 ファイル）は Apple の画面の呼び方なので使ってよい
  { id: "junbichu", pattern: /準備中/ },
  { id: "kagi", pattern: /(?<!秘密)鍵/ },
  { id: "sashikomu", pattern: /差し込/ },
  { id: "kata", pattern: /(投稿|説明)の型|型にして/ },
  { id: "tashikameru", pattern: /確かめ/ },
  { id: "midashi", pattern: /見出し/ },
  { id: "shirushi", pattern: /印を外/ },
  { id: "gazoai", pattern: /画像の ?AI/ },
];

// 表にあるが、見つける形を決められない行（確認役が文の意味から見る）
export const UI_WORD_RULES_WITHOUT_PATTERN = ["sakujo", "unei", "project", "term", "okane", "hazusu", "moji", "tsunageru", "nini", "etsuran"];
