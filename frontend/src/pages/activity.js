import React, { useState, useEffect } from "react";
import axios from "axios";

import "./css/activity.css";
import Config from "../lib/config";

import ActivityTable from "./components/activity/activity-table";
import Loading from "./components/general/loading";

function Activity() {
  const [data, setData] = useState([]);
  const [config, setConfig] = useState(null);

  const [itemCount, setItemCount] = useState(10); // Nombre d'éléments par page
  const [page, setPage] = useState(0); // Page actuelle

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config();
        setConfig(newConfig);
      } catch (error) {
        if (error.code === "ERR_NETWORK") {
          console.log(error);
        }
      }
    };

    const fetchLibraries = () => {
      const url = `/api/getHistory`;
      axios
        .get(url, {
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
          params: {
            page,
            limit: itemCount,
          },
        })
        .then((response) => {
          setData(response.data.data);
        })
        .catch((error) => {
          console.log(error);
        });
    };

    if (config) {
      fetchLibraries();
    } else {
      fetchConfig();
    }

    return () => {};
  }, [config, page, itemCount]);

  if (!data.length) {
    return <Loading />;
  }

  return (
    <div className="Activity">
      <div className="Heading">
        <h1>Activity</h1>
        <div className="pagination-range">
          <div className="header">Items</div>
          <select
            value={itemCount}
            onChange={(event) => {
              setItemCount(event.target.value);
              setPage(0); // Revenir à la première page lors du changement de nombre d'éléments
            }}
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
      <div className="Activity">
        <ActivityTable
          data={data}
          itemPerPage={itemCount}
          page={page}
          setPage={setPage}
        />
      </div>
    </div>
  );
}

export default Activity;
