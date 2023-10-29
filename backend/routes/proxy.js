const express = require("express");
const db = require("../db");
const getJellyfinClient = require("../jellyfin/jellyfin-client");

const router = express.Router();

router.get("/web/assets/img/devices/", async (req, res) => {
  const { devicename } = req.query; // Get the image URL from the query string

  const jellyfinClient = await getJellyfinClient();

  const svgData = await jellyfinClient.getImage(
    `/web/assets/img/devices/${devicename}.svg`,
  );
  if (svgData) {
    res.set("Content-Type", "image/svg+xml");
    res.status(200);
    res.send(svgData);
  } else {
    res.status(500).send("Error fetching image");
  }
});

router.get("/Items/Images/Backdrop/", async (req, res) => {
  const { id, fillWidth, quality, blur } = req.query; // Get the image URL from the query string

  let url = `/Items/${id}/Images/Backdrop?fillWidth=${
    fillWidth || 800
  }&quality=${quality || 100}&blur=${blur || 0}`;

  const jellyfinClient = await getJellyfinClient();

  const imageData = await jellyfinClient.getImage(url);
  if (imageData) {
    res.set("Content-Type", "image/jpeg");
    res.status(200);
    res.send(imageData);
  } else {
    res.status(500).send("Error fetching image");
  }
});

router.get("/Items/Images/Primary/", async (req, res) => {
  const { id, fillWidth, quality } = req.query; // Get the image URL from the query string

  let url = `/Items/${id}/Images/Primary?fillWidth=${
    fillWidth || 400
  }&quality=${quality || 100}`;

  const jellyfinClient = await getJellyfinClient();

  const imageData = await jellyfinClient.getImage(url);
  if (imageData) {
    res.set("Content-Type", "image/jpeg");
    res.status(200);
    res.send(imageData);
  } else {
    res.status(500).send("Error fetching image");
  }
});

router.get("/Users/Images/Primary/", async (req, res) => {
  const { id, fillWidth, quality } = req.query; // Get the image URL from the query string

  let url = `/Users/${id}/Images/Primary?fillWidth=${
    fillWidth || 100
  }&quality=${quality || 100}`;

  const jellyfinClient = await getJellyfinClient();

  const imageData = await jellyfinClient.getImage(url);
  if (imageData) {
    res.set("Content-Type", "image/jpeg");
    res.status(200);
    res.send(imageData);
  } else {
    res.status(500).send("Error fetching image");
  }
});

router.get("/getSessions", async (req, res) => {
  try {
    const jellyfinClient = await getJellyfinClient();

    const response_data = await jellyfinClient.getSessions();
    res.send(response_data);
  } catch (error) {
    res.status(503);
    res.send(error);
  }
});

router.get("/getAdminUsers", async (req, res) => {
  try {
    const jellyfinClient = await getJellyfinClient();

    const response = await jellyfinClient.getUsers();

    const adminUser = response.filter(
      (user) => user.Policy.IsAdministrator === true,
    );

    res.send(adminUser);
  } catch (error) {
    res.status(503);
    res.send(error);
  }
});

router.get("/getRecentlyAdded", async (req, res) => {
  try {
    const { libraryid } = req.query;
    const { rows: config } = await db.query(
      'SELECT * FROM app_config where "ID"=1',
    );
    const jellyfinClient = await getJellyfinClient();

    let userid = config[0].settings?.preferred_admin?.userid;

    if (!userid) {
      const response = await jellyfinClient.getUsers();

      const admins = response.filter(
        (user) => user.Policy.IsAdministrator === true,
      );
      userid = admins[0].Id;
    }

    const response_data = await jellyfinClient.getLatestItemsFromUser(
      userid,
      libraryid,
    );
    res.send(response_data);
  } catch (error) {
    res.status(503);
    res.send(error);
  }
});

module.exports = router;
