import { Client } from '@notionhq/client';
import { RichTextPropertyValue, TitlePropertyValue } from '@notionhq/client/build/src/api-types';
require('dotenv').config();

const notion = new Client({
    auth: process.env.NOTION_KEY,
});

type RelationPropertyValue = {
    id: string;
    type: 'relation';
    relation: {
        id: string;
    }[];
}
type URLPropertyValue = {
    id: string;
    type: 'url';
    url: string;
}

// タイトルから抽出する情報
type TitleInfo = {
    name: string;
    interviewer: string[];
}
type Info = TitleInfo & {
    title: string;
}

type MemberInfo = {
    id: string;
    name: string;
}

/**
 * タイトルから、情報取得
 */
function extractInfo(title: string): TitleInfo {
    const reg = /インタビュー】(?<name>.*)さんインタビュー（インタビューアー：(?<interviewer>.*)さん/;
    const g = title.match(reg).groups;

    // インタビュアーが複数の場合は分割
    const interviewer = g.interviewer.split(/・|、/).map((name) => {
        if (name.endsWith('さん')) {
            return name.substring(0, name.length - 2).replace(/( |　)/g, '');
        } else {
            return name.replace(/( |　)/g, '');
        }
    });
    return {
        name: g.name.replace(/( |　)/g, ''),
        interviewer,
    };
}
type UpdateInfo = {
    pageId: string; // 更新対象のページID
    interviewee?: {
        id?: string | undefined;  // インタビュイーページID。undefinedの場合、ページを作成する。
        name: string;
    } | undefined;
    interviewer: {
        id?: string | undefined;    // インタビュアーページID。undefinedの場合、ページを作成する。
        name: string;
    }[];
}
/**
 * ページ更新情報取得
 * @param memberMap Fellow一覧ページ情報（名前とページIDのマップ）
 * @returns 更新する必要のある情報
 */
async function getPageInfo(memberMap: {[name: string]: MemberInfo}): Promise<UpdateInfo[]> {
    const result = [] as UpdateInfo[];

    let hasNext = true;
    let nextCursor;

    while(hasNext) {
        const myPage = await notion.databases.query({
            database_id: process.env.INTERVIEW_DATABASE_ID,
            start_cursor: nextCursor,
        });
        myPage.results.forEach((page) => {
            const titleCol = page.properties['タイトル'] as RichTextPropertyValue;
            const title = titleCol.rich_text[0].plain_text;

            // 情報抽出
            const titleInfo = extractInfo(title);

            // リンク先ページ取得
            const info = {
                pageId: page.id,
                interviewer: [],
            } as UpdateInfo;

            // インタビュイー
            const interviewee = titleInfo.name;
            if (memberMap[interviewee] !== undefined) {
                const intervieweeCol = (page.properties['インタビュイー'] as unknown) as RelationPropertyValue;
                if (intervieweeCol.relation.findIndex(r => r.id === memberMap[interviewee].id) === -1) {
                    // インタビュイーが設定されていない場合
                    info.interviewee = {
                        id: memberMap[interviewee].id,
                        name: memberMap[interviewee].name,
                    }
                }
            } else {
                //  メンバーページ作成
                info.interviewee = {
                    name: interviewee,
                }
            }

            // インタビュアー
            titleInfo.interviewer.forEach((name) => {
                const interviewerCol = (page.properties['インタビュアー'] as unknown) as RelationPropertyValue;
                if (memberMap[name] !== undefined) {
                    if (interviewerCol.relation.findIndex(r => r.id === memberMap[name].id) === -1) {
                        // インタビュアーが設定されていない場合
                        info.interviewer.push({
                            id: memberMap[name].id,
                            name,
                        });
                    }
                } else {
                    // メンバーページ作成
                    info.interviewer.push({
                        name,
                    });
                }
            });

            if (info.interviewee !== undefined || info.interviewer.length > 0) {
                result.push(info);
            }

            nextCursor = myPage.next_cursor;
            hasNext = nextCursor !== null;
        });
    }
    return result;

}

// メンバー情報取得
async function loadFellowList(): Promise<{[name: string]: MemberInfo}> {
    const infoMap = {} as {[name: string]: MemberInfo};
    let hasNext = true;
    let nextCursor;

    while(hasNext) {
        const myPage = await notion.databases.query({
            database_id: process.env.MEMBER_DATABASE_ID,
            start_cursor: nextCursor,
        });
        myPage.results.forEach((page) => {
            const titleCol = page.properties['Name'] as TitlePropertyValue;
            if (titleCol.title.length === 0) {
                return;
            }
            const title = titleCol.title[0].plain_text;
            // 空白除去
            const key = title.replace(/( |　)/g, '');
            infoMap[key] = {
                id: page.id,
                name: title,
            };
        });
        nextCursor = myPage.next_cursor;
        hasNext = nextCursor !== null;
    }
    return infoMap;
}

/**
 * 必要なメンバーのページを作成する
 * @param updateInfo 
 */
async function createMemberPage(updateInfo: UpdateInfo[]): Promise<UpdateInfo[]> {
    // 作成する必要のある名前を抽出
    const nameList = [] as string[];
    updateInfo.forEach((info) => {
        if (info.interviewee !== undefined && info.interviewee.id === undefined) {
            if (nameList.indexOf(info.interviewee.name) === -1) {
                nameList.push(info.interviewee.name);
            }
        }
        info.interviewer.forEach((ivr) => {
            if (ivr.id === undefined) {
                if (nameList.indexOf(ivr.name) === -1) {
                    nameList.push(ivr.name);
                }
            }
        })
    });

    if (nameList.length === 0) {
        return updateInfo;
    }

    // ページ作成
    const nameIdMap = {} as {[name: string]: string};
    await Promise.all(nameList.map((name) => {
        return notion.pages.create({
            parent: {
                database_id: process.env.MEMBER_DATABASE_ID,
            },
            properties: {
                // @ts-ignore
                'Name': {
                    'title': [{
                        type: 'text',
                        text: {
                            content: name,
                        },
                    }],
                },
            },
        })
        .then((result) => {
            nameIdMap[name] = result.id;
        });
    }));

    console.log('nameIDMap', nameIdMap);

    // IDを割り当て
    return updateInfo.map((temp) => {
        const info = Object.assign({}, temp);
        if (info.interviewee !== undefined && info.interviewee.id === undefined) {
            info.interviewee.id = nameIdMap[info.interviewee.name];
        }
        info.interviewer.forEach((ivr) => {
            if (ivr.id === undefined) {
                ivr.id = nameIdMap[ivr.name];
            }
        });
        return info;
    });
}

async function updatePage(updateInfo: UpdateInfo[]) {
    Promise.all(updateInfo.map(async(info) => {
        const properties = {};
        let flag = false;
        if (info.interviewee?.id !== undefined) {
            properties['インタビュイー'] = {
                'relation': [{
                    id: info.interviewee.id,
                }],
            }
            flag = true;
        }
        if (info.interviewer.length > 0) {
            properties['インタビュアー'] = {
                'relation': info.interviewer.map(i => { 
                    return {
                        id: i.id
                    };
                }),
            }
            flag = true;
        }
        if (flag) {
            await notion.pages.update({
                page_id: info.pageId,
                // @ts-ignore
                properties,
                archived: false,
            });
        }
    }));

}

/**
 * 動画URL情報の取得
 * @returns 
 */
async function getYoutubeInfos(): Promise<{id: string; url: string;}[]> {
    let hasNext = true;
    let nextCursor;

    const pageInfos = [] as {
        id: string;
        url: string;
    }[];
    while(hasNext) {
        const myPage = await notion.databases.query({
            database_id: process.env.INTERVIEW_DATABASE_ID,
            start_cursor: nextCursor,
        });

        myPage.results.forEach((page) => {
            const thumbCol = (page.properties['ユーチューブURL'] as unknown) as URLPropertyValue;
            const url = thumbCol.url;
            pageInfos.push({
                id: page.id,
                url,
            });
        })
        nextCursor = myPage.next_cursor;
        hasNext = nextCursor !== null;
    }
    return pageInfos;
}

async function insertYoutube(pageInfos: {id: string; url: string;}[]) {
    pageInfos.forEach(async(info) => {
        // 動画ブロックがあるか確認
        const blocks = await notion.blocks.children.list({
            block_id: info.id,
        });
        const hasVideo = blocks.results.some((block) => {
            // @ts-ignore
            return block.type === 'video';
        });

        if (hasVideo) {
            return;
        }

        // 動画を追加
        await notion.blocks.children.append({
            block_id: info.id,
            children: [{
                // @ts-ignore
                type: 'video',
                video: {
                    type: 'external',
                    external: {
                        url: info.url,
                    },
                },
            }]
        });
    });
}

async function main() {
    console.log('*** loadFellowList ***');
    const memberMap = await loadFellowList();
    console.log('*** getPageInfo ***');
    const updateInfo = await getPageInfo(memberMap);
    console.log('*** createMemberPage ***');
    const newUpdateInfo = await createMemberPage(updateInfo);
    console.log(newUpdateInfo);
    console.log('*** updatePage ***');
    await updatePage(newUpdateInfo);
}

// Youtube動画を埋め込み
async function setupYoutubeMain() {
    const infos = await getYoutubeInfos();
    console.log('*** insertYoutube ***');
    await insertYoutube(infos);

}
// main();
setupYoutubeMain();
