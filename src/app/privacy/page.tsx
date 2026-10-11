import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Clauses, ExternalLink, LegalPage, LegalSection, LegalTable } from "@/components/legal/legal-page";
import { LEGAL, PENDING, orPending } from "@/lib/legal/info";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "矢書（やぶみ）が預かる情報と、その使い道・送り先・保存期間・消し方",
};

// 正は docs/architecture.md の 4.14（データの扱い）。中身を変えたら、そちらと docs/legal.md も揃える
export default function PrivacyPage() {
  const operator = orPending(LEGAL.operator);
  let n = 0;
  const next = () => ++n;

  return (
    <LegalPage
      title="プライバシーポリシー"
      lead={
        <p>
          矢書（やぶみ。以下「本サービス」）の運営者 {operator}（以下「運営者」）は、利用者の情報を次のとおり扱います。本サービスは SNS への投稿を手伝う道具なので、SNS のアカウントの連携や、AI に文章を作らせるために、利用者の情報を外部のサービスに送ることがあります。何を、どこへ、いつまで預かるかを、できるだけ具体的に書きます。
        </p>
      }
    >
      <LegalSection id="collect" n={next()} title="預かる情報">
        <LegalTable
          head={["情報", "中身", "どこから"]}
          rows={[
            ["アカウント", "メールアドレス、パスワード（ハッシュにして保存し、元のパスワードは持ちません）", "登録のとき、利用者が入力"],
            [
              "プロジェクトとアカウント設計",
              "広めたいアプリの名前・紹介文・届けたい相手、アカウント設計の内容（目的、投稿の柱、口調、名前とプロフィールの案など）",
              "利用者が入力、または AI の案から利用者が採用",
            ],
            ["投稿", "投稿の本文、SNS ごとの文面、予約の日時、送信の結果（成功・失敗の理由、SNS 上の投稿の URL）", "利用者が入力、送信のとき SNS から"],
            ["AI との会話", "アカウント設計の相談や、投稿のネタ出しでのやり取り", "利用者の入力と AI の返事"],
            [
              "SNS のアカウント",
              "SNS 上の ID、ユーザー名、表示名、SNS が発行したアクセストークン（暗号化して保存）",
              "SNS をつないだとき、SNS から",
            ],
            [
              "GitHub",
              "インストールの ID、そのアカウント名、本人が読めるリポジトリの ID、つないだリポジトリの名前、最後に読んだ日時",
              "GitHub をつないだとき、GitHub から",
            ],
            ["手で投稿する SNS", "note・Substack のプロフィールの URL（任意）", "利用者が入力"],
            ["利用量と費用", "AI の利用量（トークン数と費用）、X の API に払った額。会話や投稿の中身は入りません", "本サービスが記録"],
            [
              "技術的な情報",
              "ログインの状態を保つ cookie、画面の配色の設定の cookie、SNS や GitHub と連携するときの一時的な cookie（10 分）、サーバーのログ（IP アドレス、日時、開いたページなど）",
              "ブラウザとサーバー",
            ],
          ]}
        />
        <p>
          GitHub のファイルの中身とコミット（メッセージと差分）は、アプリの紹介文や投稿のネタを作るときに読んで AI に送るだけで、本サービスには保存しません。保存するのは、利用者が採用した紹介文と、AI が出したネタ（どのコミットを元にしたかの印と、AI の説明）です。.env・鍵・証明書など秘密が入りがちなファイルは読みません。
        </p>
      </LegalSection>

      <LegalSection id="purpose" n={next()} title="使い道">
        <Clauses
          items={[
            "本サービスを提供するため（ログイン、投稿の保存と予約、SNS への送信、AI による案の作成、GitHub のリポジトリの読み取り）",
            "利用者が選んだ SNS へ、利用者の指示どおりに投稿し、取り消すため",
            "AI や X の API の費用が上限を超えないように数えるため",
            "問い合わせへの返答、障害の調査、不正な利用を防ぐため",
            "規約や本サービスの大事な変更を知らせるため",
          ]}
        />
        <p>
          運営者は、預かった情報を広告に使ったり、売ったりしません。AI の学習のために、運営者が利用者の情報を提供することもありません（Anthropic の扱いは次の条）。
        </p>
      </LegalSection>

      <LegalSection id="third-parties" n={next()} title="外部のサービスに送るもの">
        <p>
          本サービスは次のサービスを使います。SNS と GitHub へは、利用者がつないだときに、利用者の指示を受けて送ります。それ以外は、本サービスを動かすために運営者が委託している先です。
        </p>
        <LegalTable
          head={["送り先", "使い道", "送るもの", "国"]}
          rows={[
            [
              <>
                Anthropic（Claude API）
                <br />
                <ExternalLink href="https://www.anthropic.com/legal/privacy">プライバシーポリシー</ExternalLink>
              </>,
              "AI による案の作成（アカウント設計の相談、アプリの紹介文、投稿のネタ）",
              "AI との会話、プロジェクトとアカウント設計の内容、紹介文を作るときの GitHub のファイル、ネタを作るときの GitHub のコミット",
              "米国（処理は米国・欧州・アジア・オーストラリアの一部の国で行われることがあり、保存は米国）",
            ],
            [
              <>
                Meta（Threads）
                <br />
                <ExternalLink href="https://help.instagram.com/515230437301944">プライバシーポリシー</ExternalLink>
              </>,
              "Threads への投稿、取り消し、トークンの延長",
              "投稿の本文、アクセストークン",
              "米国",
            ],
            [
              <>
                X
                <br />
                <ExternalLink href="https://x.com/ja/privacy">プライバシーポリシー</ExternalLink>
              </>,
              "X への投稿、取り消し、トークンの延長",
              "投稿の本文、アクセストークン",
              "米国",
            ],
            [
              <>
                GitHub
                <br />
                <ExternalLink href="https://docs.github.com/ja/site-policy/privacy-policies/github-general-privacy-statement">プライバシーステートメント</ExternalLink>
              </>,
              "リポジトリの読み取り",
              "読み取りの依頼（どのリポジトリの、どのファイルやコミットか）",
              "米国",
            ],
            [
              <>
                Supabase
                <br />
                <ExternalLink href="https://supabase.com/privacy">プライバシーポリシー</ExternalLink>
              </>,
              "データベース、ログイン",
              "本サービスが預かる情報のすべて（第 1 条）",
              "米国の会社。データは東京のサーバーに保存",
            ],
            [
              <>
                Vercel
                <br />
                <ExternalLink href="https://vercel.com/legal/privacy-policy">プライバシーポリシー</ExternalLink>
              </>,
              "画面とサーバーの処理",
              "画面の表示と処理に要る情報、サーバーのログ",
              "米国の会社。処理は主に東京のサーバー",
            ],
            [
              <>
                Resend
                <br />
                <ExternalLink href="https://resend.com/legal/privacy-policy">プライバシーポリシー</ExternalLink>
              </>,
              "登録の確認、パスワードの再設定、メールアドレスの変更のメールの送信",
              "メールアドレス、メールの本文",
              "米国",
            ],
            [
              <>
                Cloudflare（Turnstile）
                <br />
                <ExternalLink href="https://www.cloudflare.com/ja-jp/privacypolicy/">プライバシーポリシー</ExternalLink>
              </>,
              "登録・ログイン・パスワードを忘れたときの画面で、ロボットによる大量の登録や不正なログインを防ぐ",
              "ブラウザと端末の情報（IP アドレス、ブラウザの種類など）",
              "米国",
            ],
          ]}
        />
        <p className="font-bold">Anthropic（Claude API）での扱い</p>
        <Bullets
          items={[
            <>
              Anthropic は、API で送られた内容を、既定ではモデルの学習に使いません（
              <ExternalLink href="https://www.anthropic.com/legal/commercial-terms">Anthropic の商用規約</ExternalLink>）。運営者は学習への利用を許可していません。
            </>,
            <>
              Anthropic は、送られた内容と AI の返事を、受け取ってから 30 日以内に消します。ただし、Anthropic の利用規定に反する疑いがあると判定された場合は、最長 2 年保存されることがあります（
              <ExternalLink href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data">Anthropic のヘルプ</ExternalLink>）。
            </>,
            "Anthropic は、運営者の委託を受けて処理する立場（データの処理者）で、Anthropic のデータ処理の補足契約に沿って扱います。",
          ]}
        />
        <p>
          SNS に投稿した内容は、その SNS のサービスとして公開され、その SNS の規約とプライバシーポリシーに沿って扱われます。投稿の公開範囲や削除は、それぞれの SNS の決まりに従います。
        </p>
      </LegalSection>

      <LegalSection id="overseas" n={next()} title="外国にある会社へ送ることについて">
        <p>
          前の条の送り先の多くは米国の会社です（個人情報の保護に関する法律の「外国にある第三者」）。米国には、日本の個人情報保護法にあたる連邦全体の包括的な法律はなく、分野や州ごとの法律で守られています（
          <ExternalLink href="https://www.ppc.go.jp/personalinfo/legal/kaiseihogohou/#gaikoku">個人情報保護委員会「外国における個人情報の保護に関する制度等の調査」</ExternalLink>
          ）。各社は、それぞれのプライバシーポリシーや契約で、個人情報の保護の措置をとっています。
        </p>
      </LegalSection>

      <LegalSection id="retention" n={next()} title="保存する期間">
        <LegalTable
          head={["情報", "保存する期間"]}
          rows={[
            ["アカウント", "退会まで"],
            ["プロジェクト、アカウント設計、投稿と送信の結果", "利用者が消すか、退会まで"],
            ["AI との会話", `利用者が消すか、最後のやり取りから 1 年${PENDING}で自動で消す。投稿のネタ出しは、プロジェクトごとに新しい 10 回分だけ残す`],
            ["SNS のトークンとアカウントの情報", "SNS をつないでいる間。外す・退会するとすぐに消す（外しても、過去の投稿の送信の結果は残る）"],
            ["GitHub の連携の情報", "つないでいる間"],
            [
              "AI の利用量、X の API の費用",
              `13 か月${PENDING}で自動で消す。退会したときは、利用者との紐づけを外して（誰のものかわからない形で）残す。月の上限の計算と費用の記録に使うため。会話や投稿の中身は入っていない`,
            ],
            ["サーバーのログ", "Vercel と Supabase の保存期間（短いもので約 1 時間、長いもので数日）。トークンや投稿の本文はログに出さない"],
            ["送ったメールの記録", "Resend の保存期間"],
          ]}
        />
        <p>本サービスのデータベースには、いまは自動のバックアップがありません。消したデータは、その時点でデータベースからなくなります。バックアップを取るようにしたときは、この条を書き換えて知らせます。</p>
      </LegalSection>

      <LegalSection id="delete" n={next()} title="消す方法と退会">
        <Bullets
          items={[
            "プロジェクト、投稿、GitHub のリポジトリのつなぎは、それぞれの画面から消せます。プロジェクトを消すと、その中の投稿・アカウント設計・会話も消えます",
            "AI との会話は、会話の画面の「この会話を消す」で消せます。採用した設計の内容は残ります",
            "SNS は、「つないだ SNS」の「外す」で、トークンとアカウントの情報を消せます。X は X の側でも連携を取り消します",
            "退会は「アカウント」の画面の「退会する」から、パスワードを入れ直して行います。前の条の「紐づけを外して残す」もの以外は、すべてすぐに消えます",
            "SNS に投稿したものは、退会しても消えません（SNS 上の投稿は利用者のものだからです）。消したいときは、退会の前に投稿の画面の「SNS から取り消す」を使うか、SNS で直接消してください",
          ]}
        />
        <p className="font-bold">SNS や GitHub の側で連携を外す方法</p>
        <Bullets
          items={[
            "Threads: Threads のアプリの「設定」→「アカウント」→「ウェブサイトのアクセス許可」から矢書を削除できます。削除すると、Meta から本サービスに知らせが届き、トークンを消します。Meta のデータ削除の依頼を受けたときは、Threads のアカウントの情報とトークンを消し、確認のページと確認コードを返します",
            <>
              X: X の「設定とプライバシー」→「セキュリティとアカウントアクセス」→「アプリとセッション」→「連携しているアプリ」から外せます（
              <ExternalLink href="https://x.com/settings/connected_apps">連携しているアプリ</ExternalLink>）
            </>,
            <>
              GitHub: GitHub の Settings → Applications → Installed GitHub Apps から外せます（
              <ExternalLink href="https://github.com/settings/installations">Installed GitHub Apps</ExternalLink>）。退会のときは、ほかの矢書の利用者が同じインストールを使っていなければ、本サービスの側からも外します
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="security" n={next()} title="安全のための取り組み">
        <Bullets
          items={[
            "SNS のアクセストークンは、データベースに入れる前に暗号化します（AES-256-GCM）。鍵はデータベースとは別の場所に置き、データベースの中身だけが漏れてもトークンは読めないようにしています",
            "データベースは、行ごとに持ち主を確かめる仕組み（行単位のアクセス制御）で、他の利用者の情報を読めないようにしています。他の利用者から読めないことを自動のテストで確かめています",
            "通信はすべて暗号化（HTTPS）します",
            "SNS の ID とパスワードは預かりません。連携は各社の公式の認可の仕組み（OAuth）で行います",
            "GitHub は読み取りの権限だけで連携し、書き込みはしません。読むたびに、そのリポジトリだけに絞った一時的な鍵を発行し、保存しません",
          ]}
        />
      </LegalSection>

      <LegalSection id="cookie" n={next()} title="cookie">
        <p>
          ログインの状態を保つため、画面の配色（ライト・ダーク）を覚えるため、SNS や GitHub との連携でなりすましを防ぐため（10 分で消える）に cookie を使います。広告や、利用者の行動を追う解析のための cookie は使いません。
        </p>
      </LegalSection>

      <LegalSection id="requests" n={next()} title="開示・訂正・利用停止などのお願い">
        <p>
          本人から、預かっている情報の開示、訂正、追加、削除、利用の停止、第三者への提供の停止を求められたときは、本人であることを確かめたうえで、法律に沿って遅れなく対応します。多くは、画面から自分で確かめ、直し、消すことができます。画面でできないことは、問い合わせ先（{orPending(LEGAL.contact)}）にご連絡ください。
        </p>
      </LegalSection>

      <LegalSection id="age" n={next()} title="年齢">
        <p>本サービスは {LEGAL.minAge} 歳以上の方を対象にしています{PENDING}。</p>
      </LegalSection>

      <LegalSection id="changes" n={next()} title="このポリシーの変更">
        <p>
          使うサービスや機能が変わったときは、このポリシーを書き換えます。大事な変更（新しい送り先、使い道の追加など）は、施行の前に本サービスの画面やメールで知らせます。新しい SNS（Instagram、Facebook、TikTok、YouTube など）をつなげるようにするときは、その SNS について書き足してから始めます。
        </p>
      </LegalSection>

      <LegalSection id="contact" n={next()} title="運営者と問い合わせ先">
        <Bullets items={[`運営者: ${operator}`, `問い合わせ先: ${orPending(LEGAL.contact)}`]} />
        <p>
          利用の条件は <Link href="/terms" className="text-primary hover:underline">利用規約</Link> をご覧ください。
        </p>
      </LegalSection>
    </LegalPage>
  );
}
