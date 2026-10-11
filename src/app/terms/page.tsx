import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Clauses, ExternalLink, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { LEGAL, PENDING, operatorLabel, orPending } from "@/lib/legal/info";

export const metadata: Metadata = {
  title: "利用規約",
  description: "矢書（やぶみ）を使うときの約束",
};

// オーナーに確かめてほしい点は docs/legal.md。データの扱いはプライバシーポリシー（/privacy）と docs/architecture.md の 4.14
export default function TermsPage() {
  const operator = operatorLabel();
  let n = 0;
  const next = () => ++n;

  return (
    <LegalPage
      title="利用規約"
      lead={
        <p>
          この規約は、矢書（やぶみ。以下「本サービス」）を使うときの、利用者と運営者 {operator}（以下「運営者」）との約束です。登録する前にお読みください。登録した時点で、この規約と
          <Link href="/privacy" className="text-primary hover:underline">
            プライバシーポリシー
          </Link>
          に同意したものとします。
        </p>
      }
    >
      <LegalSection id="service" n={next()} title="本サービスでできること">
        <p>
          本サービスは、個人開発者などがアプリを SNS で広めるための道具です。アカウントの設計を AI と相談する、投稿の文面を作る、複数の SNS に投稿・予約する、GitHub のリポジトリからアプリの紹介文や投稿のネタを作る、などができます。使える SNS と機能は、画面に出ているものです。まだ使えない機能は「準備中」と出しています。
        </p>
      </LegalSection>

      <LegalSection id="account" n={next()} title="登録とアカウント">
        <Clauses
          items={[
            `本サービスは ${LEGAL.minAge} 歳以上の方が使えます${PENDING}。`,
            "登録には、本人のメールアドレスを使ってください。1 人で複数のアカウントを作ったり、アカウントを他の人に貸したり譲ったりしないでください。",
            "パスワードは自分で管理してください。他の人に使われたと気づいたときは、すぐにパスワードを変え、運営者に知らせてください。",
            "運営者は、登録できる人を限ることがあります（招待した人だけ、など）。",
          ]}
        />
      </LegalSection>

      <LegalSection id="price" n={next()} title="料金">
        <Clauses
          items={[
            "いまは無料です。",
            "AI の利用と X への投稿には外部の費用がかかるため、利用者ごと・本サービス全体で、月の上限を設けています。上限に達すると、その月はその機能が使えなくなるか、手で投稿する形に切り替わります。",
            "有料のプランを始めるときは、料金と内容を前もって知らせ、利用者が申し込んだときだけ料金がかかるようにします。黙って有料に切り替えることはしません。",
          ]}
        />
      </LegalSection>

      <LegalSection id="sns" n={next()} title="SNS と GitHub との連携">
        <Clauses
          items={[
            "SNS（Threads、X など）と GitHub は、各社の公式の認可の仕組みでつなぎます。本サービスは、各社の ID やパスワードを預かりません。",
            "本サービスは、利用者が「送る」「予約」を押したものだけを、利用者のアカウントから投稿します。利用者が確かめていない文面を、本サービスが勝手に投稿することはありません。",
            <>
              利用者は、つないだ SNS と GitHub の規約を守ってください。主なもの:
              <Bullets
                items={[
                  <ExternalLink key="threads" href="https://help.instagram.com/769983657850450">Threads 利用規約</ExternalLink>,
                  <ExternalLink key="x" href="https://x.com/ja/tos">X 利用規約</ExternalLink>,
                  <ExternalLink key="xa" href="https://help.x.com/ja/rules-and-policies/x-automation">X の自動化のルール</ExternalLink>,
                  <ExternalLink key="gh" href="https://docs.github.com/ja/site-policy/github-terms/github-terms-of-service">GitHub 利用規約</ExternalLink>,
                ]}
              />
            </>,
            "同じ文面や、ほとんど同じ文面を、複数の X のアカウントに投稿しないでください（X の自動化のルールで禁じられています）。",
            "SNS の側の都合（仕様や料金の変更、障害、審査、アカウントの制限）で、投稿できない・遅れる・機能が使えなくなることがあります。投稿の結果は、投稿の画面の「送信の結果」で確かめてください。",
            "note と Substack は、公式の投稿の仕組みがないため、本サービスからは投稿しません。利用者が手で投稿し、記録する形です。",
          ]}
        />
      </LegalSection>

      <LegalSection id="ai" n={next()} title="AI の案">
        <Clauses
          items={[
            "本サービスは、Anthropic の AI（Claude）を使って、アカウント設計の案、紹介文、投稿のネタと下書きを作ります。AI に送る内容は、プライバシーポリシーに書いています。",
            "AI の案は、まちがっていたり、事実と違ったり、他の人の権利に触れたりすることがあります。投稿する前に、必ず中身を確かめて、自分の言葉として直してください。採用して投稿するかどうかは、利用者が決めます。",
            "AI との会話に、他の人の個人情報や、秘密にすべき情報（パスワード、鍵、顧客の情報など）を書かないでください。",
            "AI の案を採用して作ったものの権利は、利用者のものです（運営者は権利を主張しません）。",
          ]}
        />
      </LegalSection>

      <LegalSection id="content" n={next()} title="利用者が入れた内容">
        <Clauses
          items={[
            "利用者が本サービスに入れた文章や、本サービスで作った投稿の権利は、利用者のものです。",
            "運営者は、本サービスを動かすため（保存、表示、SNS への送信、AI に送ること）にだけ、その内容を使います。宣伝などほかの目的に使うときは、前もって利用者の許可を得ます。",
            "投稿の内容と、投稿したことの結果は、利用者が責任を持ちます。",
          ]}
        />
      </LegalSection>

      <LegalSection id="prohibited" n={next()} title="してはいけないこと">
        <Bullets
          items={[
            "法律や、公序良俗に反すること",
            "他の人の権利（著作権、商標権、肖像権、プライバシーなど）を侵すこと",
            "スパム（同じ内容の大量の投稿、望まれていない宣伝、無関係な人へのメンション）や、SNS の規約に反する投稿",
            "人をだます内容、差別や嫌がらせ、暴力をあおる内容の投稿",
            "他の人の SNS のアカウントを、その人の許可なくつなぐこと",
            "本サービスや、つないだ SNS・GitHub に、過剰な負荷をかけたり、不正にアクセスしたりすること",
            "本サービスの月の上限や制限を、すり抜けようとすること",
            "AI に、本サービスの使い道と関係のない作業をさせたり、Anthropic の利用規定に反する内容を作らせたりすること",
            "その他、運営者が本サービスの運営のために適切でないと判断した行為",
          ]}
        />
      </LegalSection>

      <LegalSection id="suspend" n={next()} title="利用の停止">
        <p>
          利用者が前の条のことをしたとき、またはそのおそれが高いとき、運営者は事前の知らせなしに、投稿の予約を止める、アカウントを使えなくする、などの対応をとることがあります。急ぎでないときは、先に理由を知らせ、直す機会を設けます。
        </p>
      </LegalSection>

      <LegalSection id="change-stop" n={next()} title="本サービスの変更・休止・終了">
        <Clauses
          items={[
            "運営者は、本サービスの内容を変えたり、点検や障害のために一時的に止めたりすることがあります。",
            "本サービスを終えるときは、終える日の 30 日前までに知らせます。その間に、利用者は自分の投稿などを確かめられます。",
          ]}
        />
      </LegalSection>

      <LegalSection id="withdraw" n={next()} title="退会">
        <p>
          利用者は、「アカウント」の画面からいつでも退会できます。退会すると、預かっている情報は
          <Link href="/privacy#retention" className="text-primary hover:underline">
            プライバシーポリシー
          </Link>
          のとおり消えます。SNS に投稿したものは消えないので、消したいときは退会の前に取り消してください。
        </p>
      </LegalSection>

      <LegalSection id="disclaimer" n={next()} title="運営者の責任">
        <Clauses
          items={[
            "運営者は、本サービスが正しく動くよう、また預かった情報を守るよう、注意を払って運営します。ただし、本サービスが利用者の目的（フォロワーやダウンロードが増える、など）に合うこと、いつでも止まらずに動くことまでは約束できません。",
            "SNS の仕様の変更や障害、SNS によるアカウントの制限、AI の案の誤りによって利用者に損害が出たときは、運営者に故意または重大な過失がある場合を除き、運営者は責任を負いません。",
            "運営者が責任を負う場合でも、運営者に故意または重大な過失がある場合を除き、直接かつ通常の損害に限ります。",
            "利用者が消費者契約法の消費者にあたる場合で、この条の定めが同法により無効となるときは、その部分は適用しません。",
          ]}
        />
      </LegalSection>

      <LegalSection id="revise" n={next()} title="規約の変更">
        <p>
          運営者は、法律や本サービスの内容が変わったときなどに、この規約を変えることがあります。変えるときは、変える内容と施行日を、施行日より前に本サービスの画面やメールで知らせます。施行日のあとも本サービスを使い続けた場合は、変更後の規約に同意したものとします。
        </p>
      </LegalSection>

      <LegalSection id="law" n={next()} title="準拠法と裁判所">
        <p>
          この規約は日本の法律に従います。本サービスについて争いが起きたときは、{orPending(LEGAL.court)}を第一審の専属的な合意管轄裁判所とします。
        </p>
      </LegalSection>

      <LegalSection id="contact" n={next()} title="運営者と問い合わせ先">
        <Bullets items={[`運営者: ${operator}`, `問い合わせ先: ${orPending(LEGAL.contact)}`]} />
      </LegalSection>
    </LegalPage>
  );
}
