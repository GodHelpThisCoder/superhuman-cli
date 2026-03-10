declare module "chrome-remote-interface" {
  namespace CDP {
    interface Client {
      Runtime: any;
      Input: any;
      Network: any;
      Page: any;
      close(): Promise<void>;
      [key: string]: any;
    }
  }

  function CDP(options?: any): Promise<CDP.Client>;

  namespace CDP {
    function List(options?: any): Promise<any[]>;
  }

  export = CDP;
}
