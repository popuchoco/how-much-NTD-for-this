# 現金怎麼配｜新台幣拆鈔計算器

輸入一筆新台幣金額，查看可用紙鈔與硬幣的所有精確拆分組合，也可比較件數最少、硬幣最多與紙鈔最少的代表解；或輸入目標與已持有的金額／鈔幣數量，計算還差多少並找出補足配法。這是純前端靜態網站，免安裝、無外部執行期依賴；偏好只存於目前瀏覽器，金額與持有數量不會儲存。

- **公開網站：**[現金怎麼配](https://ntd-cash-splitter.duskylark33.chatgpt.site/)
- **公開原始碼：**[popuchoco/how-much-NTD-for-this](https://github.com/popuchoco/how-much-NTD-for-this)

## 功能

- 紙鈔面額：NT$2,000、1,000、500、200、100。
- 硬幣面額：NT$50、20、10、5、1；5 角（NT$0.5）可選擇啟用。
- 計算器可選「付剛好」或「多付再找零」；後者最多找零 NT$20，明細先列找零最少的方式，再依找零金額由少到多排列。
- 計算器的原創 Q 版紙鈔與硬幣 SVG，以中央銀行照片中的主色作為面額辨識提示；認識頁仍保留原始央行照片。
- 可使用紙鈔與硬幣、僅紙鈔或僅硬幣，並自訂要納入計算的面額。
- 「湊足金額」頁可輸入目標與目前持有的總額，或逐項填入鈔幣張數／枚數，計算差額、補足方式與多種配法；已達標或超額時會顯示對應狀態。
- 顯示精確組合總數、組合明細與代表解；明細預設列出 100 組，最多載入 500 組。
- 自訂面額、計算模式與 5 角偏好記在 `localStorage`；金額不會儲存或上傳。
- 新台幣介紹頁以中央銀行照片介紹鈔幣設計與發行日期；紀念幣與紀念鈔券分區介紹，不作為額外計算面額。
- 生活應用頁提供六個原創國小二年級情境，以及國小三年級估算、四年級數值捨入的進階例子；估算只作判斷參考，結帳仍以精確金額為準。
- 紀念幣與 NT$50 紀念性塑膠鈔券不納入計算；建國百年 NT$100 紀念券仍按一般 NT$100 面額處理，計算器不區分設計版別。
- 單筆輸入上限為 NT$200,000；不符合目前可用面額的金額會顯示原因。

## 計算方式

半元以整數 tick 儲存（NT$1 = 2 ticks、NT$0.5 = 1 tick），避免浮點誤差。計數器先用面額 ticks 的最大公因數縮放狀態空間，再用完全背包動態規劃精確計算組合數（`BigInt`）。代表解由多組動態規劃分別求得；組合明細採有上限的回溯列舉。完整設計、複雜度與目前邊界請見 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 文件

- [`ARCHITECTURE.md`](ARCHITECTURE.md)：資料模型、演算法、限制與程式審查追蹤。
- [`TEST_PLAN.md`](TEST_PLAN.md)：回歸測試範圍、使用者試錯情境與人工瀏覽器驗收矩陣。
- [`DESIGN.md`](DESIGN.md)：跨頁視覺方向與無障礙基線。
- [`life-applications.html`](life-applications.html)：依政府數學課程與二年級教材學習重點設計的生活練習頁；情境為原創，不是官方教材題目。
- [`make-up.html`](make-up.html) 與 [`make-up.js`](make-up.js)：以已持有金額或面額數量計算目標差額及補足配法。
- [`assets/central-bank/CREDITS.md`](assets/central-bank/CREDITS.md)：中央銀行照片來源、授權與歸屬說明。
- [`LICENSE`](LICENSE)：專案授權條款。

## 本機預覽與測試

無需建置或安裝套件。可直接開啟 `index.html`，或在專案目錄執行：

```sh
python -m http.server 8000
```

再瀏覽 `http://localhost:8000`。執行測試：

```sh
node --test
```

## 來源與授權

鈔幣圖案與發行日期整理自[中央銀行新臺幣鈔票資料](https://www.cbc.gov.tw/public/data/issue/money/a1/t02.html)、[流通硬幣資料](https://www.cbc.gov.tw/public/data/issue/money/a1/t04.htm)、[五十週年紀念性塑膠鈔券資料](https://www.cbc.gov.tw/public/data/issue/money/a1/50-4.HTM)、[建國百年壹佰圓券資料](https://www.cbc.gov.tw/public/data/issue/money/a1/100-3.HTM)與[建國一百年流通拾圓硬幣資料](https://www.cbc.gov.tw/public/data/issue/money/A2/100th10.htm)。中央銀行照片依其[政府網站資料開放宣告](https://www.cbc.gov.tw/tw/cp-307-36676-DE020-1.html)及[政府資料開放授權條款第 1 版](https://data.gov.tw/license)標示使用；照片素材不屬於本專案的 GFDL 授權範圍，詳細資訊見 `CREDITS.md`。

生活應用頁參考以下數學領域內容：國民小學二年級數學領域－認識錢幣、國民小學三年級數學領域－估算法、國民小學四年級數學領域－數值捨入法。頁面例題由本專案自行編寫，非官方教材摘錄或教育機關認可內容。

本專案以 **GNU Free Documentation License 1.2（GFDL 1.2）** 授權。使用照片時請依其各自授權與來源標示辦理。

## 發布狀態

原始碼倉庫與 ChatGPT Site 均為公開。網站目前部署於上述 ChatGPT Site；GitHub Pages 尚未配置。
