const https = require("https");
const axios = require("axios");
const db = require("../db");

class JellyfinClient {
  constructor(hostUrl, apiKey) {
    if (!hostUrl || !apiKey) {
      throw new Error(
        "Misconfigured Jellyfin CLient, missing hostUrl or apiKey",
      );
    }
    this.hostUrl = hostUrl;
    this.apiKey = apiKey;
    const agent = new https.Agent({
      rejectUnauthorized:
        (
          process.env.REJECT_SELF_SIGNED_CERTIFICATES || "true"
        ).toLowerCase() === "true",
    });

    this.axios_instance = axios.create({
      httpsAgent: agent,
    });
  }

  async getUsers() {
    try {
      const url = `${this.hostUrl}/Users`;
      const response = await this.axios_instance.get(url, {
        headers: {
          "X-MediaBrowser-Token": this.apiKey,
        },
      });
      return response.data;
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  async getAdminUser() {
    try {
      const url = `${this.hostUrl}/Users`;
      const response = await this.axios_instance.get(url, {
        headers: {
          "X-MediaBrowser-Token": this.apiKey,
        },
      });

      const adminUser = response.data.filter(
        (user) => user.Policy.IsAdministrator === true,
      );
      return adminUser || null;
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  async getItem(ids, params) {
    try {
      let url = `${this.hostUrl}/Items?ids=${ids}`;
      let startIndex = params && params.startIndex ? params.startIndex : 0;
      let increment = params && params.increment ? params.startIndex : 200;
      let recursive =
        params && params.recursive !== undefined ? params.recursive : true;
      let total = 200;

      let final_response = [];
      while (startIndex < total && total !== undefined) {
        const response = await this.axios_instance.get(url, {
          headers: {
            "X-MediaBrowser-Token": this.apiKey,
          },
          params: {
            startIndex: startIndex,
            recursive: recursive,
            limit: increment,
          },
        });

        total = response.data.TotalRecordCount;
        startIndex += increment;

        final_response = [...final_response, ...response.data.Items];
      }

      return final_response;
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  async getLibrariesFromApi() {
    try {
      let url = `${this.hostUrl}/Library/MediaFolders`;

      const response_data = await this.axios_instance.get(url, {
        headers: {
          "X-MediaBrowser-Token": this.apiKey,
        },
      });

      return response_data.data.Items.filter(
        (type) => !["boxsets", "playlists"].includes(type.CollectionType),
      );
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  async getItems(key, id, types) {
    try {
      let url = `${
        this.hostUrl
      }/Items?${key}=${id}&includeItemTypes=${types.join(",")}`;
      let startIndex = 0;
      let increment = 200;
      let recursive = true;
      let total = 200;

      let final_response = [];
      while (startIndex < total && total !== undefined) {
        const response = await this.axios_instance.get(url, {
          headers: {
            "X-MediaBrowser-Token": this.apiKey,
          },
          params: {
            startIndex: startIndex,
            recursive: recursive,
            limit: increment,
          },
        });

        total = response.data.TotalRecordCount;
        startIndex += increment;

        final_response.push(...response.data.Items);
      }

      // const results = response.data.Items;
      if (key === "userid") {
        return final_response.filter(
          (type) => !["boxsets", "playlists"].includes(type.CollectionType),
        );
      } else {
        // return final_response.filter((item) => item.ImageTags.Primary);
        return final_response;
      }
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  async getItemPlaybackInfo(itemID, userid) {
    try {
      let url = `${this.hostUrl}/Items/${itemID}/playbackinfo?userId=${userid}`;

      const response = await this.axios_instance.get(url, {
        headers: {
          "X-MediaBrowser-Token": this.apiKey,
        },
      });

      return response.data.MediaSources;
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  async getLatestItemsFromUser(userId, libraryId) {
    try {
      let url = `${this.hostUrl}/users/${userId}/Items/latest`;
      if (libraryId) {
        url += `?parentId=${libraryId}`;
      }

      const response = await this.axios_instance.get(url, {
        headers: {
          "X-MediaBrowser-Token": this.apiKey,
        },
      });

      return response.data;
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  async getSessions() {
    try {
      let url = `${this.hostUrl}/Sessions`;

      const response = await this.axios_instance.get(url, {
        headers: {
          "X-MediaBrowser-Token": this.apiKey,
        },
      });

      return response.data;
    } catch (error) {
      this.handleAxiosErrorLogging(error);
      return [];
    }
  }

  handleAxiosErrorLogging(error) {
    if (error.response) {
      console.log(error.stack);
    } else {
      console.log(error);
    }
  }

  async getItemsOfType(filtered_libraries, types) {
    const data = [];
    //for each item in library run get item using that id as the ParentId (This gets the children of the parent id)
    for (let i = 0; i < filtered_libraries.length; i++) {
      const library = filtered_libraries[i];
      let libraryItems = (await this.getItems("parentId", library.Id, types))
        // Strange mapping needed, removing it breaks things further down the line
        .map((item) => {
          item.ParentId = library.Id;
          return item;
        });
      data.push(...libraryItems);
    }
    return data;
  }

  async getPlugins() {
    //Playback Reporting Plugin Check
    const pluginURL = `${this.hostUrl}/plugins`;

    const pluginResponse = await this.axios_instance.get(pluginURL, {
      headers: {
        "X-MediaBrowser-Token": this.apiKey,
      },
    });
    return pluginResponse.data;
  }

  async getImage(url) {
    return this.axios_instance
      .get(`${this.hostUrl}${url}`, {
        responseType: "arraybuffer",
      })
      .then((response) => {
        if (response.headers["content-type"].startsWith("image/")) {
          return response.data;
        } else {
          throw new Error("Response is not an image");
        }
      })
      .catch((error) => {
        this.handleAxiosErrorLogging(error);
      });
  }
}
async function getJellyfinClient() {
  const { rows: config } = await db.query(
    'SELECT * FROM app_config where "ID"=1',
  );

  return new JellyfinClient(config[0]?.JF_HOST, config[0]?.JF_API_KEY);
}

module.exports = getJellyfinClient;
