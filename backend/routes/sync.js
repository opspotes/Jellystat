const express = require("express");
const pgp = require("pg-promise")();
const db = require("../db");
const moment = require("moment");
const { randomUUID } = require("crypto");

const getJellyfinClient = require("../jellyfin/jellyfin-client");

const router = express.Router();

const {
  jf_libraries_columns,
  jf_libraries_mapping,
} = require("../models/jf_libraries");
const {
  jf_library_items_columns,
  jf_library_items_mapping,
} = require("../models/jf_library_items");
const {
  jf_library_seasons_columns,
  jf_library_seasons_mapping,
} = require("../models/jf_library_seasons");
const {
  jf_library_episodes_columns,
  jf_library_episodes_mapping,
} = require("../models/jf_library_episodes");
const {
  jf_item_info_columns,
  jf_item_info_mapping,
} = require("../models/jf_item_info");
const {
  columnsPlaybackReporting,
  mappingPlaybackReporting,
} = require("../models/jf_playback_reporting_plugin_data");

const { jf_users_columns, jf_users_mapping } = require("../models/jf_users");
const taskName = require("../logging/taskName");
const { insertLog } = require("./logging");

/////////////////////////////////////////Functions

async function getExistingIDsforTable(tablename) {
  return await db
    .query(
      `SELECT "Id"
             FROM ${tablename}`,
    )
    .then((res) => res.rows.map((row) => row.Id));
}

async function insertData(tablename, dataToInsert, column_mappings) {
  let result = await db.insertBulk(tablename, dataToInsert, column_mappings);
  if (result.Result === "SUCCESS") {
  } else {
    throw new Error("Error performing bulk insert:" + result.message);
  }
}

async function removeData(tablename, dataToRemove) {
  let result = await db.deleteBulk(tablename, dataToRemove);
  if (result.Result === "SUCCESS") {
    console.log(dataToRemove.length + " Rows Removed.");
  } else {
    throw new Error("Error :" + result.message);
  }
}

////////////////////////////////////////API Methods

async function syncUserData() {
  const jellyfinClient = await getJellyfinClient();

  const data = await jellyfinClient.getUsers();

  const existingIds = await getExistingIDsforTable("jf_users"); // get existing user Ids from the db

  let dataToInsert = data.map(jf_users_mapping);

  if (dataToInsert.length > 0) {
    await insertData("jf_users", dataToInsert, jf_users_columns);
  }

  const toDeleteIds = existingIds.filter(
    (id) => !data.some((row) => row.Id === id),
  );
  if (toDeleteIds.length > 0) {
    await removeData("jf_users", toDeleteIds);
  }

  //update usernames on log table where username does not match the user table
  await db.query(
    'UPDATE jf_playback_activity a SET "UserName" = u."Name" FROM jf_users u WHERE u."Id" = a."UserId" AND u."Name" <> a."UserName"',
  );
}

async function syncLibraryFolders(data) {
  const existingIds = await getExistingIDsforTable("jf_libraries"); // get existing library Ids from the db

  let dataToInsert = await data.map(jf_libraries_mapping);

  if (dataToInsert.length !== 0) {
    await insertData("jf_libraries", dataToInsert, jf_libraries_columns);
  }

  //----------------------DELETE FUNCTION
  //GET EPISODES IN SEASONS
  //GET SEASONS IN SHOWS
  //GET SHOWS IN LIBRARY
  //FINALY DELETE LIBRARY
  const toDeleteIds = existingIds.filter(
    (id) => !data.some((row) => row.Id === id),
  );
  if (toDeleteIds.length > 0) {
    const ItemsToDelete = await db
      .query(
        `SELECT "Id"
                 FROM jf_library_items
                 where "ParentId" in (${toDeleteIds
                   .map((id) => `'${id}'`)
                   .join(",")})`,
      )
      .then((res) => res.rows.map((row) => row.Id));
    if (ItemsToDelete.length > 0) {
      await removeData("jf_library_items", ItemsToDelete);
    }

    await removeData("jf_libraries", toDeleteIds);
  }
}

async function syncLibraryItems(libraries) {
  const jellyfinClient = await getJellyfinClient();
  let data = await jellyfinClient.getItemsOfType(libraries, [
    "Movie",
    "Audio",
    "Series",
  ]);
  const existingLibraryIds = await getExistingIDsforTable("jf_libraries"); // get existing library Ids from the db

  data = data.filter((row) => existingLibraryIds.includes(row.ParentId));

  const existingIds = await getExistingIDsforTable("jf_library_items");

  let dataToInsert = [];
  //filter fix if jf_libraries is empty

  dataToInsert = data.map(jf_library_items_mapping);
  dataToInsert = dataToInsert.filter((item) => item.Id !== undefined);

  if (dataToInsert.length > 0) {
    await insertData(
      "jf_library_items",
      dataToInsert,
      jf_library_items_columns,
    );
  }

  const toDeleteIds = existingIds.filter(
    (id) => !data.some((row) => row.Id === id),
  );
  if (toDeleteIds.length > 0) {
    await removeData("jf_library_items", toDeleteIds);
  }

  console.log(
    `${
      dataToInsert.length - existingIds.length > 0
        ? dataToInsert.length - existingIds.length
        : 0
    } Rows Inserted. ${existingIds.length} Rows Updated.`,
  );
  console.log(toDeleteIds.length + " Library Items Removed.");
}

async function syncShowItems(filtered_libraries) {
  const jellyfinClient = await getJellyfinClient();
  const data = await jellyfinClient.getItemsOfType(filtered_libraries, [
    "Season",
    "Episode",
  ]);
  const { rows: shows } = await db.query(
    `SELECT *
         FROM public.jf_library_items
         where "Type" = 'Series'`,
  );

  let insertSeasonsCount = 0;
  let insertEpisodeCount = 0;
  let updateSeasonsCount = 0;
  let updateEpisodeCount = 0;

  let deleteSeasonsCount = 0;
  let deleteEpisodeCount = 0;

  //loop for each show
  for (const show of shows) {
    const allSeasons = data.filter(
      (item) => item.Type === "Season" && item.SeriesId === show.Id,
    );
    const allEpisodes = data.filter(
      (item) => item.Type === "Episode" && item.SeriesId === show.Id,
    );

    const existingIdsSeasons = await db
      .query(
        `SELECT *
                 FROM public.jf_library_seasons
                 where "SeriesId" = '${show.Id}'`,
      )
      .then((res) => res.rows.map((row) => row.Id));
    let existingIdsEpisodes = [];
    if (existingIdsSeasons.length > 0) {
      existingIdsEpisodes = await db
        .query(
          `SELECT *
                     FROM public.jf_library_episodes
                     WHERE "SeasonId" IN (${existingIdsSeasons
                       .filter((seasons) => seasons !== "")
                       .map((seasons) => pgp.as.value(seasons))
                       .map((value) => "'" + value + "'")
                       .join(", ")})`,
        )
        .then((res) => res.rows.map((row) => row.EpisodeId));
    }

    let seasonsToInsert = [];
    let episodesToInsert = [];

    seasonsToInsert = await allSeasons.map(jf_library_seasons_mapping);
    episodesToInsert = await allEpisodes.map(jf_library_episodes_mapping);

    //Bulkinsert new data not on db
    if (seasonsToInsert.length !== 0) {
      let result = await db.insertBulk(
        "jf_library_seasons",
        seasonsToInsert,
        jf_library_seasons_columns,
      );
      if (result.Result === "SUCCESS") {
        insertSeasonsCount +=
          seasonsToInsert.length - existingIdsSeasons.length;
        updateSeasonsCount += existingIdsSeasons.length;
      } else {
        console.log("Error performing bulk insert:" + result.message);
      }
    }
    const toDeleteIds = existingIdsSeasons.filter(
      (id) => !allSeasons.some((row) => row.Id === id),
    );
    //Bulk delete from db thats no longer on api
    if (toDeleteIds.length > 0) {
      let result = await db.deleteBulk("jf_library_seasons", toDeleteIds);
      if (result.Result === "SUCCESS") {
        deleteSeasonsCount += toDeleteIds.length;
      } else {
        console.log("Error: " + result.message);
      }
    }
    //insert delete episodes
    //Bulkinsert new data not on db
    if (episodesToInsert.length !== 0) {
      let result = await db.insertBulk(
        "jf_library_episodes",
        episodesToInsert,
        jf_library_episodes_columns,
      );
      if (result.Result === "SUCCESS") {
        insertEpisodeCount +=
          episodesToInsert.length - existingIdsEpisodes.length;
        updateEpisodeCount += existingIdsEpisodes.length;
      } else {
        console.log("Error performing bulk insert:" + result.message);
      }
    }

    const toDeleteEpisodeIds = existingIdsEpisodes.filter(
      (id) => !allEpisodes.some((row) => row.Id === id),
    );
    //Bulk delete from db thats no longer on api
    if (toDeleteEpisodeIds.length > 0) {
      let result = await db.deleteBulk(
        "jf_library_episodes",
        toDeleteEpisodeIds,
      );
      if (result.Result === "SUCCESS") {
        deleteEpisodeCount += toDeleteEpisodeIds.length;
      } else {
        console.log("Error: " + result.message);
      }
    }
  }

  console.log(
    `Seasons: ${
      insertSeasonsCount > 0 ? insertSeasonsCount : 0
    } Rows Inserted. ${updateSeasonsCount} Rows Updated.`,
  );
  console.log(deleteSeasonsCount + " Seasons Removed.");
  console.log(
    `Episodes: ${
      insertEpisodeCount > 0 ? insertEpisodeCount : 0
    } Rows Inserted. ${updateEpisodeCount} Rows Updated.`,
  );
  console.log(deleteEpisodeCount + " Episodes Removed.");
}

async function removeOrphanedData() {
  console.log("Removing Orphaned FileInfo/Episode/Season Records");

  await db.query("CALL jd_remove_orphaned_data()");

  console.log("Orphaned FileInfo/Episode/Season Removed.");
}

async function syncPlaybackPluginData() {
  console.time("syncPlaybackPluginData");
  const jellyfinClient = await getJellyfinClient();

  //Playback Reporting Plugin Check
  const pluginResponse = await jellyfinClient.getPlugins();

  const hasPlaybackReportingPlugin = pluginResponse?.filter(
    (plugins) =>
      plugins?.ConfigurationFileName ===
      "Jellyfin.Plugin.PlaybackReporting.xml",
  );

  if (!hasPlaybackReportingPlugin || hasPlaybackReportingPlugin.length === 0) {
    console.log("Playback Reporting Plugin not detected. Skipping step.");
    return;
  }

  const OldestPlaybackActivity = await db
    .query(
      'SELECT  MIN("ActivityDateInserted") "OldestPlaybackActivity" FROM public.jf_playback_activity',
    )
    .then((res) => res.rows[0]?.OldestPlaybackActivity);

  const MaxPlaybackReportingPluginID = await db
    .query(
      'SELECT MAX(rowid) "MaxRowId" FROM jf_playback_reporting_plugin_data',
    )
    .then((res) => res.rows[0]?.MaxRowId);

  //Query Builder
  let query = `SELECT rowid, *
                 FROM PlaybackActivity`;

  if (OldestPlaybackActivity) {
    const formattedDateTime = moment(OldestPlaybackActivity).format(
      "YYYY-MM-DD HH:mm:ss",
    );

    query = query + ` WHERE DateCreated < '${formattedDateTime}'`;

    if (MaxPlaybackReportingPluginID) {
      query = query + ` AND rowid > ${MaxPlaybackReportingPluginID}`;
    }
  } else if (MaxPlaybackReportingPluginID) {
    query = query + ` WHERE rowid > ${MaxPlaybackReportingPluginID}`;
  }

  query += " order by rowid";

  console.log("Query built. Executing.");
  //

  const url = `${base_url}/user_usage_stats/submit_custom_query`;

  const response = await axios_instance.post(
    url,
    {
      CustomQueryString: query,
    },
    {
      headers: {
        "X-MediaBrowser-Token": apiKey,
      },
    },
  );

  const PlaybackData = response.data.results;

  let DataToInsert = await PlaybackData.map(mappingPlaybackReporting);

  if (DataToInsert.length > 0) {
    console.log(`Inserting ${DataToInsert.length} Rows.`);
    let result = await db.insertBulk(
      "jf_playback_reporting_plugin_data",
      DataToInsert,
      columnsPlaybackReporting,
    );

    if (result.Result === "SUCCESS") {
      console.log(`${DataToInsert.length} Rows have been inserted.`);
      console.log(
        "Running process to format data to be inserted into the Activity Table",
      );
      await db.query("CALL ji_insert_playback_plugin_data_to_activity_table()");
      console.log("Process complete. Data has been inserted.");
    } else {
      console.log("Error: " + result.message);
    }
  } else {
    console.log(`No new data to insert.`);
  }

  console.timeEnd("syncPlaybackPluginData");
}

async function updateLibraryStatsData() {
  await db.query("CALL ju_update_library_stats_data()");
}

async function fullSync(triggertype) {
  console.log(`Starting fullsync [${triggertype}]`);
  let startTime = moment();

  const jellyfinClient = await getJellyfinClient();
  console.log("Starting fetching libraries");
  const libraries = await jellyfinClient.getLibrariesFromApi();
  if (libraries.length === 0) {
    console.log("Error: No Libraries found to sync.");
    return;
  }
  console.log(`Ended fetching libraries, got [${libraries.length}]`);
  const { rows } = await db.query('SELECT * FROM app_config where "ID"=1');
  const excluded_libraries = rows[0].settings.ExcludedLibraries || [];

  const filtered_libraries = libraries.filter(
    (library) => !excluded_libraries.includes(library.Id),
  );

  console.time("syncUserData");
  console.log("syncUserData");
  await syncUserData();
  console.timeEnd("syncUserData");

  console.time("syncLibraryFolders");
  console.log("syncLibraryFolders");
  await syncLibraryFolders(filtered_libraries);
  console.timeEnd("syncLibraryFolders");

  console.time("syncLibraryItems");
  console.log("syncLibraryItems");
  await syncLibraryItems(filtered_libraries);
  console.timeEnd("syncLibraryItems");

  console.time("syncShowItems");
  console.log("syncShowItems");
  await syncShowItems(filtered_libraries);
  console.timeEnd("syncShowItems");

  //removeOrphanedData
  console.time("removeOrphanedData");
  console.log("removeOrphanedData");
  await removeOrphanedData();
  console.timeEnd("removeOrphanedData");

  console.time("updateLibraryStatsData");
  console.log("updateLibraryStatsData");
  await updateLibraryStatsData();
  console.timeEnd("updateLibraryStatsData");


  await insertLog(randomUUID(), "Automatic", "Jellyfin Sync");
  console.log("Finished fullsync");
}

////////////////////////////////////////API Calls

///////////////////////////////////////Sync All
router.get("/beingSync", async (req, res) => {
  // TODO // execution
  await fullSync();
  res.send();
});

async function fetchItem(req, res, shouldRespond) {
  try {
    const { itemId } = req.body;
    if (itemId === undefined) {
      res.status(400);
      res.send("The itemId field is required.");
    }

    const { rows: config } = await db.query(
      'SELECT * FROM app_config where "ID"=1',
    );
    const { rows: temp_lib_id } = await db.query(
      'SELECT "Id" FROM jf_libraries limit 1',
    );

    const jellyfinClient = await getJellyfinClient();

    let userid = config[0].settings?.preferred_admin?.userid;

    if (!userid) {
      const admins = await jellyfinClient.getAdminUser();
      userid = admins[0].Id;
    }

    let item = await jellyfinClient.getItem(itemId);
    const libraryItemWithParent = item.map((items) => ({
      ...items,
      ...{ ParentId: temp_lib_id[0].Id },
    }));

    let item_info = await jellyfinClient.getItemPlaybackInfo(itemId, userid);

    let itemToInsert = libraryItemWithParent.map(
      jf_library_items_mapping,
    );
    let itemInfoToInsert = item_info.map(jf_item_info_mapping);

    if (itemToInsert.length !== 0) {
      let result = await db.insertBulk(
        "jf_library_items",
        itemToInsert,
        jf_library_items_columns,
      );
      if (result.Result === "SUCCESS") {
        let result_info = await db.insertBulk(
          "jf_item_info",
          itemInfoToInsert,
          jf_item_info_columns,
        );
        if (result_info.Result === "SUCCESS") {
          if (shouldRespond) {
            res.send("Item Synced");
          }
        } else {
          res.status(500);
          res.send("Unable to insert Item Info: " + result_info.message);
        }
      } else {
        res.status(500);
        res.send("Unable to insert Item: " + result.message);
      }
    } else {
      res.status(404);
      res.send("Unable to find Item");
    }
  } catch (error) {
    // console.log(error);
    res.status(500);
    res.send(error);
  }
}

///////////////////////////////////////Write Users
router.post("/fetchItem", async (req, res) => {
  await fetchItem(req, res, true);
});

//////////////////////////////////////

//////////////////////////////////////////////////////syncPlaybackPluginData
router.get("/syncPlaybackPluginData", async (req, res) => {
  await syncPlaybackPluginData();
  res.send("syncPlaybackPluginData Complete");
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

//////////////////////////////////////

module.exports = { router, fullSync, fetchItem };
