import * as cassandra from "cassandra-driver";
import { readFileSync } from "fs";
import * as myTypes from "../../../utils/myTypes";
import { v4 as uuidv4 } from "uuid";
import config from "../../../../services/configuration/configuration";

let cassandraOptions: cassandra.DseClientOptions;
let defaultQueryOptions: cassandra.QueryOptions;
export let client: cassandra.Client;

export async function setup(): Promise<void> {
  switch (config.configuration.ted.dbCore) {
    case "keyspace": {
      const auth = new cassandra.auth.PlainTextAuthProvider(
        config.configuration.cassandra.keyspaceID,
        config.configuration.cassandra.keyspaceKey
      );
      const sslOptions = {
        ca: [readFileSync("src/config/AmazonRootCA1.pem", "utf-8")],
        host: config.configuration.cassandra.contactPoint[0],
        rejectUnauthorized: true,
      };
      cassandraOptions = {
        contactPoints: config.configuration.cassandra.contactPoint,
        localDataCenter: config.configuration.cassandra.localDatacenter,
        keyspace: config.configuration.cassandra.keyspace,
        policies: {
          retry: new cassandra.policies.retry.IdempotenceAwareRetryPolicy(
            new cassandra.policies.retry.RetryPolicy()
          ),
        },
        queryOptions: {
          isIdempotent: true,
        },
        authProvider: auth,
        sslOptions: sslOptions,
        protocolOptions: { port: 9142 },
      };
      defaultQueryOptions = {
        prepare: true,
        consistency: cassandra.types.consistencies.localQuorum,
      };
      break;
    }
    case "scylladb":
    case "cassandra": {
      cassandraOptions = {
        contactPoints: config.configuration.cassandra.contactPoint,
        localDataCenter: config.configuration.cassandra.localDatacenter,
        keyspace: config.configuration.cassandra.keyspace,
        policies: {
          retry: new cassandra.policies.retry.IdempotenceAwareRetryPolicy(
            new cassandra.policies.retry.RetryPolicy()
          ),
        },
        queryOptions: {
          isIdempotent: true,
        },
      };
      defaultQueryOptions = {
        prepare: true,
      };
      break;
    }
    default: {
      throw new Error("Unsupported DB core");
    }
  }
  client = new cassandra.Client(cassandraOptions);
  await client
    .connect()
    .catch(async (err: myTypes.CQLResponseError) => {
      if (
        err.code === 8704 &&
        err.message.match("^Keyspace '.*' does not exist$")
      ) {
        console.error(err);
        console.log("Creating keyspace");
        return await createKeyspace(
          config.configuration.cassandra.keyspace,
          config.configuration.cassandra
            .defaultCassandraKeyspaceOptions as myTypes.KeyspaceReplicationOptions
        );
      }
    })
    .then(() => client.connect());
}

export async function runDB(
  query: myTypes.Query,
  options?: myTypes.QueryOptions
): Promise<myTypes.ServerAnswer> {
  try {
    let rs: any;
    if (Object.keys(options || {}).length === 0 && query.params.length === 0) {
      rs = await client.execute(query.query);
    } else {
      options = { ...options, ...defaultQueryOptions };
      rs = await client.execute(query.query, query.params, options);
    }
    return processResult(rs);
  } catch (err) {
    throw err;
  }
}

export async function runMultiOpDB(
  queries: myTypes.Query[],
  options?: myTypes.QueryOptions
): Promise<myTypes.ServerAnswer> {
  let queryStr: string[] = queries.map((value: myTypes.Query) =>
    JSON.stringify(value)
  );
  try {
    if (options === undefined) options = defaultQueryOptions;
    let promises: Promise<unknown>[] = [];
    for (let query of queries) {
      promises.push(client.execute(query.query, query.params, options));
    }
    await Promise.all(promises);
    return { status: "success" };
  } catch (err) {
    throw err;
  }
}

export async function runBatchDB(
  queries: myTypes.Query[],
  options?: myTypes.QueryOptions
): Promise<myTypes.ServerAnswer> {
  let queryStr: string[] = queries.map((value: myTypes.Query) =>
    JSON.stringify(value)
  );
  try {
    if (options === undefined) options = defaultQueryOptions;
    await client.batch(queries, options);
    return { status: "success" };
  } catch (err) {
    throw err;
  }
}

function processResult(rs: any): myTypes.ServerAnswer {
  const ans = rs.first();
  if (ans == null) {
    return {
      status: "success",
      queryResults: { resultCount: 0, allResultsEnc: [], allResultsClear: [] },
    };
  }
  let queryResults: myTypes.QueryResult = { resultCount: rs.rowLength };
  queryResults.allResultsEnc = [];
  queryResults.allResultsClear = [];
  for (let i: number = 0; i < queryResults.resultCount; i++) {
    let object = JSON.parse(rs.rows[i]["[json]"]);
    try {
      JSON.parse(object["object"]);
      queryResults.allResultsEnc.push(object);
    } catch {
      queryResults.allResultsClear.push(object);
    }
  }
  if (rs.pageState !== null && rs.pageState !== undefined)
    queryResults.pageToken = rs.pageState.toString();
  return { status: "success", queryResults: queryResults };
}

export async function createKeyspace(
  keyspaceName: string,
  options: myTypes.KeyspaceReplicationOptions
): Promise<void> {
  let nameCtrl = keyspaceName.match(/^[a-zA-Z\_]*$/);
  if (nameCtrl === null) throw new Error("Invalid keyspace name");
  let res =
    "CREATE KEYSPACE " +
    keyspaceName +
    " WITH replication = " +
    JSON.stringify(options);
  res = res.split('"').join("'");
  let optionsTemp = { ...cassandraOptions };
  delete optionsTemp.keyspace;
  let clientTemp = new cassandra.Client(optionsTemp);
  await clientTemp.execute(res);
  console.log("keyspace created");
}
