# pdcaai 調査メモ

調査日: 2026-11-03

## この文書の読み方

- 「確認済み」は、掲載元または公的機関のページを実際に開けたものです。ただし多くは書誌と抄録までで、全文を読めたのは 1 本だけです。確認した範囲は文献ごとに書きます。
- 「未確認」は、掲載元を開けなかったものです。作品の主張の根拠には使わないでください。
- ページの読み取りには要約付きの取得ツールを使いました。提出物に数値を載せる前に、原文を見直してください。

## 結論

- 「AIで思考力が落ちる」と因果で言える根拠は、今回の範囲では限定的です。実験で示されたのは高校数学の学習(Bastani ら、抄録の転載で確認)で、批判的思考との関係を示す調査は自己報告か相関です。
- pdcaai に近い根拠は「思考力の低下」より「AI利用時の自己評価のズレ」です(Fernandes ら、Caplin ら)。
- pdcaai の仕組み(封印と開封、問いかけ、最小実験)を直接検証した研究は見つけていません。効果があるとは書けず、仮説として示すのが正確です。
- Opus 4.7 の3位 Maieutic は「AIが答えず問い返す」点で思想が近い作品です。差別化が必須です。

## 1. 文献

### 確認済み(6本)

| 文献 | 掲載先 | 確認した範囲 | 主要な知見 | pdcaai との関係 |
|---|---|---|---|---|
| Fernandes, Villa, Nicholls, Haavisto, Buschek, Schmidt, Kosch, Shen, Welsch (2026) AI makes you smarter but none the wiser | Computers in Human Behavior 175, 108779 / [Aalto 機関リポジトリ](https://research.aalto.fi/en/publications/ai-makes-you-smarter-but-none-the-wiser-the-disconnect-between-pe/) / [arXiv v1 全文](https://arxiv.org/html/2409.16708v1) | 機関ページの抄録と arXiv v1。掲載版の全文は未読 | LSAT の論理問題20問で、AI利用者の得点は基準集団より約3点高い一方、自己評価は約4点過大(Study 1, N=246)。Study 2 (N=452) でも再現。AIリテラシーが高いほどメタ認知の正確さが低い。著者は設計案として事後の振り返りや cognitive forcing を挙げる | 確信度を記録して結果と照合する設計の根拠。ただし設計案の提示であり、効果の検証ではない |
| Caplin, Deming, Li, Martin, Marx, Weidmann, Ye (2024) The ABC's of Who Benefits from Working with AI | [NBER Working Paper 33021](https://www.nber.org/papers/w33021) (DOI 10.3386/w33021) | NBER ページの抄録。PDFは読み取れず | 統制実験で、能力と自己認識の較正が AI の恩恵を共に左右する。能力が同じなら較正の良い人ほど恩恵が大きい。低能力を正しく自覚する人の恩恵が最大 | calibration の中心的根拠。査読前のワーキングペーパーと明記する |
| Agarwal, Moehring, Rajpurkar, Salz (2023) Combining Human Expertise with Artificial Intelligence | [NBER Working Paper 31422](https://www.nber.org/papers/w31422) (DOI 10.3386/w31422) | NBER ページの抄録 | 放射線科医に AI の予測を見せても平均成績は改善しない。AI の予測を過小評価し、自分の情報と独立に扱う信念更新の誤りが原因 | 反証的な文献。専門家は AI に頼りすぎるとは限らず、問題は「過信」より「信念更新の誤り」とも言える |
| Lee, Sarkar, Tankelevitch, Drosos, Rintel, Banks, Wilson (2025) The Impact of Generative AI on Critical Thinking | CHI '25, Article 1121 / [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1135061) (DOI 10.1145/3706598.3713778) | 公式ページの抄録 | 知識労働者319人、936事例の調査。AIへの信頼が高いほど批判的思考が少なく、自信が高いほど多い。思考の中心は検証、統合、タスク管理へ移る | 「自分で考える工程」を設計する動機。自己報告の調査で因果は示さない |
| Bertsch, Pesta, Wiscott, McDaniel (2007) The generation effect: a meta-analytic review | Memory & Cognition 35(2), 201-210 / [PubMed](https://pubmed.ncbi.nlm.nih.gov/17645161/) | PubMed の抄録 | 86研究、445の効果量のメタ分析。自分で生成すると読むだけより記憶が良く、効果量 .40(抄録では約半標準偏差)。主な調整変数も検討 | 「先に自分で書く」工程の根拠。ただし対象は記憶で、判断力や思考力ではない |
| Klein (2007) Performing a Project Premortem | [Harvard Business Review, 2007年9月号](https://hbr.org/2007/09/performing-a-project-premortem) | HBR の公開部分のみ | 計画段階で「すでに失敗した」と想定して理由を挙げる手法。疑念を言い出しやすくする狙い | 手法の出典。公開部分に効果量の記載はない |

### NBER について

上記の w33021 と w31422 を書誌まで確認しました。AI依存と批判的思考を直接扱う NBER 論文は、1回の検索では見つかっていません(存在しないとは言えません)。

### 未確認(主張の根拠に使わない)

| 文献 | 状況 |
|---|---|
| Bastani, Bastani, Sungu, Ge, Kabakcı, Mariman (2025) PNAS 122(26), e2422633122 | PNAS は開けず、[RePEc の抄録転載](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html)のみ確認。転載によると、高校生約1000人の実験で、制限のない GPT-4 群はアクセス終了後の成績が未利用群より17%低く、学習保護プロンプト版では悪影響がおおむね緩和。作品の根拠として最も有用なので、PNAS 本文を人が確認する価値が高い |
| Gerlich (2025) Societies 15(1), 6 (DOI 10.3390/soc15010006) | MDPI と DOAJ は開けず、[Harvard TagTeam の抄録転載](https://tagteam.harvard.edu/hub_feeds/2087/feed_items/13131139/content)のみ確認。転載によると N=666 で、AI頻用と批判的思考の負の相関を認知オフロードが媒介。相関研究で因果は示さない。訂正の有無も未確認 |
| Risko & Gilbert (2016) Cognitive Offloading, Trends in Cognitive Sciences 20(9), 676-688 | 検索結果で書誌のみ確認。内容は未確認 |
| Slamecka & Graf (1978) The generation effect, JEP: Human Learning and Memory 4(6), 592-604 | 検索結果で書誌のみ確認。内容は未確認 |
| Mitchell, Russo, Pennington (1989) Back to the future, Journal of Behavioral Decision Making 2(1), 25-38 | 検索結果で書誌のみ確認。結果は未確認。よく引用される「理由が約30%増える」という数値は二次情報でしか見ておらず、使わないこと |

## 2. 過去の受賞作の傾向

### 確認できた情報源

- cerebralvalley.ai の[イベント一覧](https://cerebralvalley.ai/showcase)と各イベントページ([4.7](https://cerebralvalley.ai/e/built-with-4-7-hackathon)、[4.6](https://cerebralvalley.ai/e/claude-code-hackathon))は読めましたが、ギャラリーと受賞作一覧はありませんでした。`/gallery` を付けた URL は 404 です。ログイン後の表示は未確認です。
- 受賞作は公式記事([4.7](https://www.claude.com/blog/meet-the-winners-of-built-with-opus-4-7-claude-code-hackathon)、[4.6](https://claude.com/blog/meet-the-winners-of-our-built-with-opus-4-6-claude-code-hackathon))で確認しました。
- 過去回の審査基準は、これらのページには記載がありません。デモ動画は視聴しておらず、**デモの構成の傾向は未確認**です。

### 受賞作

| 回 | 賞 | 作品 | 作り手の背景 | 題材 |
|---|---|---|---|---|
| 4.7 | 1位 | Medkit | 医師出身のエンジニア | 医師の診療訓練。エージェントがガイドラインに照らして採点 |
| 4.7 | 2位 | Wrench Board | 電子機器の修理経験者 | 基板修理の診断。仮説を更新しながら測定箇所を指示 |
| 4.7 | 3位 | Maieutic | CS教員、博士課程でAI研究 | 仕様を先に書かせる学習用IDE |
| 4.7 | 創造賞 | Virtual Puppet Theater | フルスタック開発者 | 映像と音声で動く3D人形劇 |
| 4.7 | Keep Thinking | MaestrIA | プログラミング未経験の学生 | 住宅修理の診断。職人の父の知識を活用 |
| 4.7 | Managed Agents 賞 | ARIA | 産業ソフト技術者と学生 | 工場設備の監視と作業指示 |
| 4.6 | 1位 | CrossBeam | 弁護士 | カリフォルニアの住宅許可申請 |
| 4.6 | 2位 | Elisa | ソフトウェア技術者 | 子ども向けブロック型IDE |
| 4.6 | 3位 | PostVisit.ai | 循環器内科医 | 診察後の説明支援 |
| 4.6 | Keep Thinking | TARA | 運輸行政の実務者 | 車載映像から道路投資を評価 |
| 4.6 | 創造賞 | Conductr | (記事の抽出範囲で未確認) | Claude と演奏するMIDI楽器 |

### 記事から確認できる共通点

- **題材:** 順位賞の多くは、作り手自身の職業や現場の具体的な問題です。一般向けの汎用ツールではありません。
- **実利用の証拠:** Medkit は医学部などでの試験導入の予定、Elisa は娘の自由研究での利用、TARA は「数週間の作業が5時間」という比較を示しています。
- **Claude の見せ方:** 文章生成で終わらず、専門判断の核に使っています。採点(Medkit)、仮説更新(Wrench Board)、仕様とコードのズレ分析(Maieutic)、視覚理解(TARA、Wrench Board)が例です。
- **深さの証拠:** MaestrIA は現場知識のルールを入れて評価スコアを74%から81%に上げたと記事にあります。Elisa はテスト数を示しています。
- **デモ:** 確認できたのは、最終日を動画制作に空けるべきという受賞者の助言だけです。

ここから先は私の推測です: 審査基準のインパクトと Claude の活用に対しては、「誰の、どの現場の問題か」と「Claude が何を判断しているか」を具体的に示す作品が有利だと考えます。

## 3. 類似プロダクト

| プロダクト | 分類 | 確認した内容 | pdcaai との差分 |
|---|---|---|---|
| [Maieutic](https://www.claude.com/blog/meet-the-winners-of-built-with-opus-4-7-claude-code-hackathon) | 問いかけ型の開発学習 | 仕様を書くまで編集をロック、補完なし、理由を問う質問には問い返す。仕様とコードのズレを drift/revision/bug に分類して質問。記事に測定結果の記載なし | **最も近い。** 対象は学生のコードと教員。pdcaai は作り手本人の成果物全般を扱い、封印された指摘の開封と最小実験の結果記録まで含む |
| [Khanmigo](https://www.khanmigo.ai/) | Socratic tutoring | 答えを渡さず導く学習者向けチューター。教員と保護者向け機能もある | 正解のある学習が中心。pdcaai は正解のない自作物の前提を扱う |
| [The Regret Pre-Mortem](https://upgrowth.in/ai-powered-apps/the-regret-pre-mortem/) | pre-mortem | 決定を入力すると12か月後の失敗を AI が示し、利用者も事後分析を書く。AI の失敗シナリオの表示と記述の順序はページから不明。結果の追跡機能の記載はなし | pdcaai は本人が先に考えるまで AI の指摘を封印し、実験結果の記録まで閉じる |
| [Verdict](https://mwm.ai/apps/verdict-decision-journal/6756952013) | decision journal | 確信度を5段階で記録し、後で正誤を付ける。端末内保存。ページに AI 機能の記載なし | calibration の記録は共通。pdcaai は AI の問いで前提を揺さぶり、実験を設計する |
| [Strategyzer Learning Card](https://www.strategyzer.com/library/capture-customer-insights-and-actions-with-the-learning-card) | 仮説検証 | 仮説、観察、学び、行動を書く PDF テンプレート。Test Card と対。AI の記載なし | 枠組みは近い。pdcaai は枠の記入だけでなく、前提の発見と封印開封を Claude が担う |

assumption mapping の専用ソフトは今回確認していません(Miro などのテンプレートが検索で見つかった程度です)。

## 作品へ反映すべき点

1. **Maieutic との差を最初に説明する。** 「問い返す AI」は既出です。差別化は、封印された指摘を開封する瞬間と、最小実験の結果まで閉じるループに置きます。
2. **主張を「思考力が上がる」にしない。** 根拠があるのは自己評価のズレです。「AI時代に確信と現実のズレを測り、縮める道具」と表現し、効果は未検証と明記します。Agarwal らを踏まえ、過信だけの話にもしません。
3. **確信度と結果を必須の記録にする。** 開封前の確信度と実験結果を記録して較正の変化を見せれば、根拠と「深さ」を同時に示せます。自分の開発記録を実データとして使えれば、さらに強くなります。
4. **Claude の判断を見える形にする。** 本人の回答と封印された指摘の差分を Claude が分析する場面をデモの中心に置きます。答えを出さない制約を守っていることも、評価で示します。
5. **実在の現場を1つ選ぶ。** 汎用ツールとして語らず、まず「個人開発者が自作を出す前」のように絞ります。実際の成果物が揺さぶられて実験結果が出るまでを、デモで通して見せます。
